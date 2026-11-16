struct Caster {
    mat4 boxFromWorld;  // World to the volume's unit box, centred on 0.
    ivec4 info;         // x: first word of the volume in its buffer.
};
struct PointLight { vec4 positionRadius; vec4 color; uvec4 casterMask[2]; };
layout(set=1,binding=0,std430) readonly buffer Scene {
    vec4 sunDirection;  // Toward the sun, unit length.
    vec4 sunColor;
    vec4 skyColor;
    vec4 groundColor;
    PointLight lights[32];
    Caster casters[256];
    ivec4 sunWindow; // XZ chunk origin, unused, enabled.
    uvec4 chunkMasks[128];
    vec4 chunkTops[16];
};
const int MAX_CASTERS = 256;
layout(set=2,binding=0,std430) readonly buffer Grid { int words[]; } grids[MAX_CASTERS];

const int MASK_WORDS = 16;
const float FAR = 1e30;
// World units the shadow ray starts in front of the surface.
const float SHADOW_OFFSET = 0.002;
// Bounds the walk if rounding ever stalls it.
const int MAX_STEPS = 1024;

int mortonCell(ivec3 p) {
    ivec3 bits = (p & 1) | ((p & 2) << 2) | ((p & 4) << 4);
    return bits.x | (bits.y << 1) | (bits.z << 2);
}

ivec3 enteringCell(vec3 position, vec3 direction) {
    return ivec3(mix(floor(position), ceil(position) - 1.0, lessThan(direction, vec3(0))));
}

// Returns the first occupied-cell entry parameter, or rayEnd on a miss.
// The index is the same for every invocation that reaches a call, so it is
// dynamically uniform.
#ifdef PROBE_TRACE
float probeHit(int g, vec3 start, vec3 toward, float rayEnd, out vec3 hitNormal, out vec3 hitColor) {
#else
float firstHit(int g, vec3 start, vec3 toward, float rayEnd) {
#endif
    // Clip in unit-box space before accessing this caster's voxel buffer.
    mat4 boxFromWorld = casters[g].boxFromWorld;
    vec3 boxOrigin = (boxFromWorld * vec4(start, 1.0)).xyz + 0.5;
    vec3 boxDir = mat3(boxFromWorld) * toward;
    bvec3 parallel = equal(boxDir, vec3(0));
    vec3 invBoxDir = 1.0 / mix(boxDir, vec3(1.0), parallel);
    vec3 first = -boxOrigin * invBoxDir;
    vec3 last = (1.0 - boxOrigin) * invBoxDir;
    vec3 near = mix(min(first, last), vec3(0.0), parallel);
    vec3 far = mix(max(first, last), vec3(rayEnd), parallel);
    float t = max(0.0, max(near.x, max(near.y, near.z)));
    float end = min(rayEnd, min(far.x, min(far.y, far.z)));
    vec3 parallelOrigin = mix(vec3(0.0), boxOrigin, parallel);
    if (t >= end || any(lessThan(parallelOrigin, vec3(0.0))) ||
                    any(greaterThanEqual(parallelOrigin, vec3(1.0)))) return rayEnd;

    int base = casters[g].info.x;
    ivec3 dims = ivec3(grids[g].words[base], grids[g].words[base + 1], grids[g].words[base + 2]);
    ivec3 bricks = (dims + 7) / 8;
    vec3 origin = boxOrigin * vec3(dims);
    vec3 dir = boxDir * vec3(dims);
    vec3 invDir = 1.0 / mix(dir, vec3(1.0), parallel);
    ivec3 stepDir = ivec3(sign(dir));
    ivec3 positive = max(stepDir, ivec3(0));
    ivec3 cell = clamp(enteringCell(origin + t * dir, dir), ivec3(0), dims - 1);
    int steps = 0;
    while (all(greaterThanEqual(cell, ivec3(0))) && all(lessThan(cell, dims)) && steps < MAX_STEPS) {
        ivec3 brick = cell >> 3;
        int offset = grids[g].words[base + 3 + brick.x + bricks.x * (brick.y + bricks.y * brick.z)];
        ivec3 low = brick * 8;
        ivec3 edge = low + positive * 8;
        vec3 next = mix((vec3(edge) - origin) * invDir, vec3(FAR), parallel);
        float brickExit = min(next.x, min(next.y, next.z));
        if (offset != 0) {
            int at = base + offset;
            float stop = min(end, brickExit);
            vec3 tDelta = abs(invDir);
            vec3 tMax = mix((vec3(cell + positive) - origin) * invDir, vec3(FAR), parallel);
            ivec3 local = cell - low;
            while (all(greaterThanEqual(local, ivec3(0))) && all(lessThan(local, ivec3(8))) && steps < MAX_STEPS) {
                ++steps;
                int m = mortonCell(local);
                int word = grids[g].words[at + (m >> 5)];
                if (((word >> (m & 31)) & 1) != 0) {
#ifdef PROBE_TRACE
                    ivec3 entered = low + local;
                    vec3 entry = mix((vec3(entered + max(-stepDir, ivec3(0))) - origin) * invDir, vec3(-FAR), parallel);
                    int axis = entry.x >= max(entry.y, entry.z) ? 0 : (entry.y >= entry.z ? 1 : 2);
                    vec3 normal = vec3(0);
                    normal[axis] = -float(stepDir[axis]);
                    hitNormal = normalize(transpose(mat3(boxFromWorld)) * normal);
                    uint color = uint(grids[g].words[at + MASK_WORDS + m] - 1);
                    hitColor = vec3((color >> 16) & 255u, (color >> 8) & 255u, color & 255u) / 255.0;
#endif
                    return t;
                }
                int size = 1;
                if (((word >> (m & 24)) & 255) == 0)
                    size = (word | grids[g].words[at + ((m >> 5) ^ 1)]) == 0 ? 4 : 2;
                if (size > 1) {
                    ivec3 blockLow = low + (local & ~(size - 1));
                    ivec3 blockEdge = blockLow + positive * size;
                    vec3 exits = mix((vec3(blockEdge) - origin) * invDir, vec3(FAR), parallel);
                    t = min(exits.x, min(exits.y, exits.z));
                    if (t >= stop) break;
                    ivec3 entered = clamp(enteringCell(origin + t * dir, dir), blockLow, blockLow + size - 1);
                    entered = mix(entered, blockEdge + min(stepDir, ivec3(0)), equal(exits, vec3(t)));
                    local = entered - low;
                    tMax = mix((vec3(entered + positive) - origin) * invDir, vec3(FAR), parallel);
                    continue;
                }
                t = min(tMax.x, min(tMax.y, tMax.z));
                if (t >= stop) break;
                bvec3 crossedCell = equal(tMax, vec3(t));
                local += mix(ivec3(0), stepDir, crossedCell);
                tMax += mix(vec3(0.0), tDelta, crossedCell);
            }
        }
        ++steps;
        t = brickExit;
        if (t >= end) break;
        cell = clamp(enteringCell(origin + t * dir, dir), low, low + 7);
        cell = mix(cell, edge + min(stepDir, ivec3(0)), equal(next, vec3(t)));
    }
    return rayEnd;
}

// Each light has four full-height 90-degree wedges, selected by signs of X and Z.
// Within a wedge the folded octahedral projection covers both hemispheres.
const int WEDGE_SIZE = 128;
int shadowTexel(int light, int wedge, ivec2 p) {
    return ((light * 4 + wedge) * WEDGE_SIZE + p.y) * WEDGE_SIZE + p.x;
}

// The ground-plane intersection of a sun ray identifies its world chunk.
const float SUN_CHUNK = 16.0;
const int SUN_SIZE = 128;
int sunSlot(ivec2 chunk) { return (chunk.x & 7) + 8 * (chunk.y & 7); }
int sunTexel(int slot, ivec2 p) {
    return 32 * 4 * WEDGE_SIZE * WEDGE_SIZE + (slot * SUN_SIZE + p.y) * SUN_SIZE + p.x;
}
uint sunMask(int slot, int word) { return chunkMasks[2 * slot + (word >> 2)][word & 3]; }
