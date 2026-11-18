// Shared std430 layout with ProbeField.dk. Each level has 256 roots.
// Near/far roots span 2/8 world units, with eight lookup cells per axis.
const int ROOTS = 512, LEAVES = 512, BATCHES = 64;
struct ProbeBatch { ivec4 target; vec4 faces[6]; };
layout(set=3,binding=0,std430) buffer Field {
    float depthAtlas[3145728];
    ivec4 roots[ROOTS];          // world root coordinate, count in low 10 bits, motion update flag in bit 10
    vec4 focus;
    int lookup[ROOTS * LEAVES]; // root-local leaf index + 1; zero means solid
    vec4 positions[ROOTS * LEAVES]; // xyz, empty leaf width
    vec4 history[ROOTS * LEAVES * 6]; // irradiance RGB and packed distance moments
    ProbeBatch batches[BATCHES];
    float casterBounds[256 * 6]; // World AABB center and half-extents.
};
int rootSlot(ivec3 r) { return (r.x & 7) + 8 * (r.z & 7) + 64 * (r.y & 3); }
float lodWeight(vec3 p, float scale) {
    vec3 d = (p-focus.xyz)/scale;
    float horizontal = max(abs(d.x),abs(d.z));
    return (1.0-smoothstep(3.0,5.5,horizontal)) *
           (1.0-smoothstep(0.75,1.75,-d.y)) * (1.0-smoothstep(2.0,3.75,d.y));
}
int probeAt(vec3 p, int level) {
    float scale = level == 0 ? 1.0 : 4.0;
    ivec3 r = ivec3(floor(p * (0.5/scale)));
    int s = level*256 + rootSlot(r);
    if (roots[s].w == 0 || any(notEqual(roots[s].xyz,r))) return -1;
    ivec3 v = ivec3(floor(p * (4.0/scale))) & 7;
    int id = lookup[s*512 + v.x + 8*v.y + 64*v.z] - 1;
    return id < 0 ? -1 : s*512 + id;
}
// Dense upload indices change when a sibling subdivides. Each disjoint leaf
// owns the finest cell containing its center, a stable address within this root.
int historySlot(int id) {
    ivec3 v = ivec3(floor(positions[id].xyz * (id < 256*512 ? 4.0 : 1.0))) & 7;
    return (id & ~511) + v.x + 8*v.y + 64*v.z;
}
vec3 faceDir(int f) {
    vec3 n = vec3(0);
    n[f >> 1] = (f & 1) == 0 ? 1.0 : -1.0;
    return n;
}
vec2 moments(vec4 f) { return unpackHalf2x16(floatBitsToUint(f.w)); }
float packMoments(vec2 m) { return uintBitsToFloat(packHalf2x16(m)); }
