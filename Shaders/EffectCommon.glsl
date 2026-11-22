// Shared by the effect compute shaders. Each effect owns a fixed slot in a page
// buffer. Offsets below are in words from the slot's base and must match
// QuaxelEffectSlot in Source/Core/Effects.dk.
//
//   VOLUME     3 dimension words, a 512-entry brick directory, then 512 bricks
//              of BRICK words at fixed offsets: 16 occupancy words, then 512
//              colors. The voxel trace reads it as an ordinary volume. A
//              directory entry is 0 for an empty brick.
//   SOLID      one bit per cell: solid world voxels, baked when the effect starts.
//   PARTICLES  STRIDE words per particle.
//   PARAMS     the effect's style and timing, written by the CPU.

layout(push_constant) uniform Params {
    mat4 matrix;   // Bake: slot cell centre to collider grid coordinates.
    int base;      // First word of the slot in the page.
    int step;      // Simulate: fixed steps since the effect started.
    float dt;      // Simulate: seconds per step.
    int tick;      // Stamp: changes every step, for flicker.
    ivec3 cells;   // Bake: the collider's grid size.
    int pad;
} pc;

layout(set=0,binding=0,std430) buffer Page { int words[]; };

const int N = 64;
const int DIRECTORY = 3;
const int BRICKS = 515;
const int BRICK = 528;
const int MASK_WORDS = 16;
const int SOLID = 271104;
const int PARTICLES = 279296;
const int STRIDE = 16;
const int PARAMS = 295680;

// Params, in the field order of QuaxelEffectParams.
const int P_VOXEL = 6, P_FLOOR = 7, P_BURST = 8, P_RATE = 9, P_STOP = 10;
const int P_SPAWN_RADIUS = 11, P_SPAWN_FLAT = 12, P_SPEED_MIN = 13, P_SPEED_MAX = 14;
const int P_SPREAD = 15, P_GRAVITY = 16, P_DRAG = 17, P_WANDER = 18, P_LIFE_MIN = 19;
const int P_LIFE_MAX = 20, P_SIZE_START = 21, P_SIZE_END = 22, P_DENSITY_START = 23;
const int P_DENSITY_END = 24, P_COLOR_START = 25, P_COLOR_MIDDLE = 26, P_COLOR_END = 27;
const int P_MIDDLE_AT = 28, P_SHADE = 29, P_FLICKER = 30, P_STREAK = 31, P_CONTACT = 32;
const int P_BOUNCINESS = 33, P_STAIN_RADIUS = 34, P_STAIN_SECONDS = 35;
const int P_STAIN_COLOR = 36, P_STAIN_DRY = 37, P_SEED = 38, P_MAX_PARTICLES = 39;
const int P_DIR_X = 3;

// Contact kinds, as QuaxelEffectContact.
const int PASS = 0, DIE = 1, STICK = 2, BOUNCE = 3, SLIDE = 4;
// Particle states.
const int FREE = 0, FLYING = 1, STUCK = 2;

float pf(int i) { return intBitsToFloat(words[pc.base + PARAMS + i]); }
int pi(int i) { return words[pc.base + PARAMS + i]; }

uint hash(uint x) {
    x ^= x >> 16; x *= 0x7feb352du;
    x ^= x >> 15; x *= 0x846ca68bu;
    x ^= x >> 16; return x;
}

float unit(uint x) { return float(hash(x) & 0xFFFFFFu) / 16777216.0; }

uint cellHash(int x, int y, int z, uint seed) {
    return hash(seed ^ (uint(x + 1024) * 73856093u) ^ (uint(y + 1024) * 19349663u) ^ (uint(z + 1024) * 83492791u));
}

// Cell offset of the effect's origin within the grid.
vec3 originCell() { return vec3(N / 2, float(N) * pf(P_FLOOR), N / 2); }

// Position relative to the origin, in world units, to a grid cell.
ivec3 toCell(vec3 local) { return ivec3(floor(local / pf(P_VOXEL) + originCell())); }

bool inGrid(ivec3 c) { return all(greaterThanEqual(c, ivec3(0))) && all(lessThan(c, ivec3(N))); }

int cellIndex(ivec3 c) { return c.x + N * (c.y + N * c.z); }

bool solidCell(ivec3 c) {
    if (!inGrid(c)) return false;
    int i = cellIndex(c);
    return ((words[pc.base + SOLID + (i >> 5)] >> (i & 31)) & 1) != 0;
}

bool solidAt(vec3 local) { return solidCell(toCell(local)); }

int mortonCell(ivec3 p) {
    ivec3 bits = (p & 1) | ((p & 2) << 2) | ((p & 4) << 4);
    return bits.x | (bits.y << 1) | (bits.z << 2);
}

int brickOf(ivec3 c) { ivec3 b = c >> 3; return b.x + 8 * (b.y + 8 * b.z); }

// Writes the color only. EffectBricks.comp rebuilds the occupancy bits.
void putVoxel(ivec3 c, int rgb) {
    if (!inGrid(c)) return;
    words[pc.base + BRICKS + brickOf(c) * BRICK + MASK_WORDS + mortonCell(c & 7)] = (rgb & 0xFFFFFF) + 1;
}

vec3 rgbOf(int c) { return vec3((c >> 16) & 255, (c >> 8) & 255, c & 255); }

int packRgb(vec3 v) {
    ivec3 c = ivec3(clamp(v, 0.0, 255.0));
    return (c.r << 16) | (c.g << 8) | c.b;
}

int mixRgb(int a, int b, float t) { return packRgb(mix(rgbOf(a), rgbOf(b), clamp(t, 0.0, 1.0))); }

int scaleRgb(int c, float f) { return packRgb(rgbOf(c) * f); }

vec3 perpendicular(vec3 axis) {
    vec3 helper = abs(axis.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0);
    return normalize(cross(axis, helper));
}

// A unit vector at most `degrees` from axis, from two uniform numbers.
vec3 cone(vec3 axis, float degrees, float u, float v) {
    vec3 forward = length(axis) < 0.5 ? vec3(0, 1, 0) : normalize(axis);
    vec3 side = perpendicular(forward);
    vec3 up = cross(side, forward);
    float limit = cos(radians(clamp(degrees, 0.0, 180.0)));
    float cosine = mix(1.0, limit, u);
    float sine = sqrt(max(0.0, 1.0 - cosine * cosine));
    float turn = v * 6.2831853;
    return forward * cosine + side * (cos(turn) * sine) + up * (sin(turn) * sine);
}

// Particle field offsets.
const int F_POS = 0, F_VEL = 3, F_AGE = 6, F_LIFE = 7, F_SEED = 8, F_STATE = 9;
const int F_NORMAL = 10, F_RADIUS = 13, F_STRETCH = 14, F_ALONG = 15;

int particleAt(int i) { return pc.base + PARTICLES + i * STRIDE; }
float rf(int at, int f) { return intBitsToFloat(words[at + f]); }
void wf(int at, int f, float v) { words[at + f] = floatBitsToInt(v); }
vec3 rv(int at, int f) { return vec3(rf(at, f), rf(at, f + 1), rf(at, f + 2)); }
void wv(int at, int f, vec3 v) { wf(at, f, v.x); wf(at, f + 1, v.y); wf(at, f + 2, v.z); }
