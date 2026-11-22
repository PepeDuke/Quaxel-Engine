// Execute the shared effect kernels over one slot in Wasm memory. WebGL 2
// consumes the resulting brick texture but cannot dispatch compute shaders.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace {
using uint = uint32_t;
using vec3 = float __attribute__((ext_vector_type(3)));
using vec4 = float __attribute__((ext_vector_type(4)));
using ivec3 = int __attribute__((ext_vector_type(3)));
vec3 vector3(float a) { return (vec3)a; }
vec3 vector3(float a,float b,float c) { return {a,b,c}; }
ivec3 integer3(int a) { return (ivec3)a; }
ivec3 integer3(int a,int b,int c) { return {a,b,c}; }
ivec3 integer3(vec3 v) { return __builtin_convertvector(v,ivec3); }
using std::floor;
using std::abs;
float mix(float a,float b,float t) { return a+(b-a)*t; }
vec3 floor(vec3 v) { return __builtin_elementwise_floor(v); }
vec3 abs(vec3 v) { return __builtin_elementwise_abs(v); }
float dot(vec3 a,vec3 b) { vec3 p=a*b; return p.x+p.y+p.z; }
float length(vec3 v) { return std::sqrt(dot(v,v)); }
vec3 normalize(vec3 v) { return v/length(v); }
vec3 cross(vec3 a,vec3 b) { return a.yzx*b.zxy-a.zxy*b.yzx; }
float radians(float d) { return d*0.01745329252f; }
template<class T> T mix(T a,T b,float t) { return a+(b-a)*t; }
template<class T,class U> T min(T a,U b) { return std::min(a,T(b)); }
template<class T,class U> T max(T a,U b) { return std::max(a,T(b)); }
template<class T,class U,class V> T clamp(T a,U b,V c) { return min(max(a,b),c); }
vec3 clamp(vec3 v,double a,double b) { return {std::clamp(v.x,(float)a,(float)b),std::clamp(v.y,(float)a,(float)b),std::clamp(v.z,(float)a,(float)b)}; }
bool all(ivec3 v) { return v.x && v.y && v.z; }
ivec3 greaterThanEqual(ivec3 a,ivec3 b) { return a>=b; }
ivec3 lessThan(ivec3 a,ivec3 b) { return a<b; }
float intBitsToFloat(int n) { return __builtin_bit_cast(float,n); }
int floatBitsToInt(float n) { return __builtin_bit_cast(int,n); }
uint packSnorm4x8(vec4 v) {
    uint result=0;
    for(int i=0;i<4;i++) result |= uint(uint8_t(int(std::round(std::clamp(v[i],-1.f,1.f)*127.f))))<<(8*i);
    return result;
}
vec4 unpackSnorm4x8(uint packed) {
    vec4 result;
    for(int i=0;i<4;i++) result[i]=std::max(-1.f,int8_t(packed>>(8*i))/127.f);
    return result;
}

struct { int base,step,tick; float dt; } pc;
ivec3 gl_GlobalInvocationID;
int *words;
#define QUAXEL_SOFTWARE_EFFECTS
#define vec3(...) vector3(__VA_ARGS__)
#define ivec3(...) integer3(__VA_ARGS__)
#define vec4(v,w) ((vec4){(v).x,(v).y,(v).z,w})
#include "../../../Shaders/EffectCommon.glsl"
#define main simulateParticle
#include "../../../Shaders/EffectSim.glsl"
#undef main
#define main stampParticle
#include "../../../Shaders/EffectStamp.glsl"
#undef main

constexpr int slotWords=295808;
int *slots[128];
int capacity;
bool selectSlot(int slot) {
    if (slot<0 || slot>=capacity || !slots[slot]) return false;
    words=slots[slot];
    return true;
}
}

// Keep effect handles disjoint from regular volume handles.
constexpr int effectHandleBase=0x40000000;
extern "C" void qx_upload_words(int handle,const int *data,int count);
extern "C" const int *qx_volume(int handle);

extern "C" int qx_pages(int pages) {
    if (pages<0 || pages>16) return false;
    capacity=std::max(capacity,pages*8);
    return true;
}
extern "C" int qx_reset(int slot) {
    if (slot<0 || slot>=capacity) return false;
    if (!slots[slot]) slots[slot]=static_cast<int*>(calloc(slotWords,sizeof(int)));
    if (!selectSlot(slot)) return false;
    memset(words,0,slotWords*sizeof(int));
    words[0]=words[1]=words[2]=N;
    return true;
}
extern "C" int qx_params(int slot,const void *data,int bytes) {
    if (!selectSlot(slot) || !data || bytes!=160) return false;
    memcpy(words+PARAMS,data,bytes);
    return true;
}
extern "C" int qx_bake(int slot,int handle,const float *matrix,int nx,int ny,int nz) {
    const int *grid=qx_volume(handle);
    if (!selectSlot(slot) || !grid) return false;
    for(int z=0;z<N;z++) for(int y=0;y<N;y++) for(int x=0;x<N;x++) {
        ivec3 cell;
        for(int a=0;a<3;a++) cell[a]=std::floor(matrix[a]*(x+.5f)+matrix[a+4]*(y+.5f)+matrix[a+8]*(z+.5f)+matrix[a+12]);
        if (!all(cell>=0) || !all(cell<integer3(nx,ny,nz))) continue;
        ivec3 b=cell>>3;
        int off=grid[3+b.x+((nx+7)/8)*(b.y+((ny+7)/8)*b.z)];
        int m=mortonCell(cell&7);
        if (off && (uint(grid[off+(m>>5)]) & (1u<<(m&31)))) {
            int i=x+N*(y+N*z);
            words[SOLID+(i>>5)] |= 1u<<(i&31);
        }
    }
    return true;
}
extern "C" int qx_simulate(int slot,int step,float seconds) {
    if (!selectSlot(slot)) return false;
    pc.step=step;
    pc.dt=seconds;
    for(int i=0;i<min(pi(P_MAX_PARTICLES),1024);i++) {
        gl_GlobalInvocationID.x=i;
        simulateParticle();
    }
    return true;
}
extern "C" int qx_stamp(int slot,int tick) {
    if (!selectSlot(slot)) return false;
    pc.tick=tick;
    for(int b=0;b<512;b++) if(words[DIRECTORY+b]) {
        memset(words+BRICKS+b*BRICK,0,BRICK*sizeof(int));
        words[DIRECTORY+b]=0;
    }
    for(int i=0;i<min(pi(P_MAX_PARTICLES),1024);i++) {
        gl_GlobalInvocationID.x=i;
        stampParticle();
    }
    // Upload only occupied bricks. Preserve the fixed slot layout for readback.
    static int packed[BRICKS+512*BRICK];
    memset(packed,0,BRICKS*sizeof(int));
    packed[0]=packed[1]=packed[2]=N;
    int used=BRICKS;
    for(int b=0;b<512;b++) {
        if (!words[DIRECTORY+b]) continue;
        int at=BRICKS+b*BRICK;
        uint any=0;
        for(int group=0;group<MASK_WORDS;group++) {
            uint mask=0;
            for(int bit=0;bit<32;bit++) if(words[at+MASK_WORDS+group*32+bit]) mask |= 1u<<bit;
            words[at+group]=mask;
            any |= mask;
        }
        words[DIRECTORY+b]=any ? at : 0;
        if (any) {
            packed[DIRECTORY+b]=used;
            memcpy(packed+used,words+at,BRICK*sizeof(int));
            used+=BRICK;
        }
    }
    qx_upload_words(effectHandleBase+slot,packed,used);
    return true;
}
extern "C" int qx_read_slot(int slot,int count,void *dest) {
    if (!selectSlot(slot) || !dest || count<=0 || count>slotWords) return false;
    memcpy(dest,words,count*sizeof(int));
    return true;
}
extern "C" void qx_stop_effects() {
    for(auto &slot:slots) { free(slot); slot=nullptr; }
    capacity=0;
    words=nullptr;
}
