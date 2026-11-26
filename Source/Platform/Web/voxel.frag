#version 450
#extension GL_EXT_samplerless_texture_functions : require
precision highp float;
precision highp int;
layout(set=0,binding=0,std430) readonly buffer Volume { int gridWords[]; };
layout(set=0,binding=1,std140) uniform Draw {
    mat4 boxFromClip;
    vec4 axes[3];
    vec4 viewport; // top-left and extent, in target pixels
    // x: 0 scene, 1 directional shadow, 2 point shadow. y, z: the occupied
    // bricks, packed x | y << 10 | z << 20, first and one past the last;
    // z == 0 means the whole grid.
    ivec4 flags;
} draw;
#define boxFromClip draw.boxFromClip
#define extent draw.viewport.zw
#define shadowPass draw.flags.x
#define occupiedLow draw.flags.y
#define occupiedHigh draw.flags.z
#define tileOrigin draw.viewport.xy
#define normals mat3(draw.axes[0].xyz,draw.axes[1].xyz,draw.axes[2].xyz)
int word(int at) { return gridWords[at]; }
#ifndef QUAXEL_DEPTH_ONLY
layout(set=1,binding=0,std140) uniform Frame {
    mat4 worldFromClip;
    mat4 lightFromWorld;
    vec4 sun, sunlight, sky, ground;
    vec4 lights[64];
    float shadowBias;
    int lightCount;
    int hasShadows;
} frame;
#define worldFromClip frame.worldFromClip
#define lightFromWorld frame.lightFromWorld
#define sun frame.sun
#define sunlight frame.sunlight
#define sky frame.sky
#define ground frame.ground
#define lights frame.lights
#define shadowBias frame.shadowBias
#define lightCount frame.lightCount
#define hasShadows (frame.hasShadows!=0)
layout(set=1,binding=1) uniform texture2D shadowMap;
layout(set=1,binding=2) uniform texture2D pointMap;
layout(location=0) out vec4 color;
#endif
ivec3 unpackBricks(int packed) { return ivec3(packed & 1023, (packed >> 10) & 1023, (packed >> 20) & 1023); }

int morton(ivec3 p) {
    ivec3 bits = (p & 1) | ((p & 2) << 2) | ((p & 4) << 4);
    return bits.x | (bits.y << 1) | (bits.z << 2);
}

void main() {
    vec2 pixel=gl_FragCoord.xy-tileOrigin;
    vec2 xy=pixel*2.0/vec2(extent)-1.0;
    ivec3 dims = ivec3(word(0),word(1),word(2));
    ivec3 bricks = (dims+7)/8;
    vec3 origin = ((boxFromClip*vec4(xy,0,1)).xyz+0.5)*vec3(dims);
    vec3 ray = boxFromClip[2].xyz*vec3(dims);
    if (shadowPass==2) {
        origin=(boxFromClip[3].xyz+0.5)*vec3(dims);
        ray=(boxFromClip*vec4(xy,1,0)).xyz*vec3(dims);
    }
    ivec3 stepDir = ivec3(sign(ray));
    bvec3 parallel = equal(stepDir,ivec3(0));
    vec3 inv = 1.0/mix(ray,vec3(1),parallel);
    ivec3 positive = max(stepDir,ivec3(0));
    // Clip to the occupied bricks. Outside them the grid is empty, so the
    // hit, its depth and its face are the same as for the whole grid.
    ivec3 occupiedFirst=ivec3(0), occupiedEnd=dims;
    if (occupiedHigh!=0) {
        occupiedFirst=unpackBricks(occupiedLow)*8;
        occupiedEnd=min(unpackBricks(occupiedHigh)*8,dims);
    }
    float t=0.0, end=1.0;
    int face=1;
    for (int a=0; a<3; a++) {
        if (parallel[a]) {
            if (origin[a]<float(occupiedFirst[a]) || origin[a]>=float(occupiedEnd[a])) discard;
        } else {
            float lo=(float(occupiedFirst[a])-origin[a])*inv[a], hi=(float(occupiedEnd[a])-origin[a])*inv[a];
            if (min(lo,hi)>t) { t=min(lo,hi); face=a; }
            end=min(end,max(lo,hi));
        }
    }
    vec3 pos=origin+t*ray;
    ivec3 cell=clamp(ivec3(mix(floor(pos),ceil(pos)-1.0,lessThan(ray,vec3(0)))),occupiedFirst,occupiedEnd-1);
    while (t<end && all(greaterThanEqual(cell,ivec3(0))) && all(lessThan(cell,dims))) {
        ivec3 brick=cell/8;
        int base=word(3+brick.x+bricks.x*(brick.y+bricks.y*brick.z));
        int index=morton(cell & 7);
        int mask=base!=0 ? word(base+(index>>5)) : 0;
        if (base!=0 && ((mask>>(index&31))&1)!=0) {
#ifdef QUAXEL_DEPTH_ONLY
            gl_FragDepth=t;
            return;
#else
            if (shadowPass!=0) { gl_FragDepth=t; color=vec4(0); return; }
            int rgb=word(base+16+index)-1;
            vec3 n=normals[face]*float(stepDir[face]==0 ? 1 : -stepDir[face]);
            vec3 ambient=mix(ground.rgb,sky.rgb,n.y*0.5+0.5);
            float ao=1.0;
            if ((rgb>>24)==2) {
                int side=face*2+(stepDir[face]<0 ? 1 : 0);
                int corners=word(base-1024+2*index+(side>>2))>>(8*(side&3));
                vec4 shade=1.0-0.2*vec4((ivec4(corners)>>ivec4(0,2,4,6))&3);
                vec3 f=clamp(origin+t*ray-vec3(cell),0.0,1.0);
                ao=mix(mix(shade.x,shade.y,f[(face+1)%3]),mix(shade.z,shade.w,f[(face+1)%3]),f[(face+2)%3]);
            }
            vec3 world=(worldFromClip*vec4(xy,t,1)).xyz;
            float visibility=1.0;
            vec3 uv=(lightFromWorld*vec4(world,1)).xyz;
            if (hasShadows && all(greaterThanEqual(uv,vec3(0))) && all(lessThanEqual(uv,vec3(1)))) {
                float slope=1.0/max(0.15,dot(n,sun.xyz));
                vec2 texel=1.0/vec2(textureSize(shadowMap,0));
                visibility=0.0;
                for(int sy=-1;sy<=1;sy++) for(int sx=-1;sx<=1;sx++)
                    visibility+=step(uv.z-shadowBias*slope*2.0,texelFetch(shadowMap,clamp(ivec2(uv.xy/texel)+ivec2(sx,sy),ivec2(0),textureSize(shadowMap,0)-1),0).r)/9.0;
            }
            vec3 light=ambient*ao+sunlight.rgb*(visibility*max(dot(n,sun.xyz),0.0)*mix(1.0,ao,0.35));
            for (int i=0; i<lightCount; i++) {
                vec4 lamp=lights[i*2];
                vec3 d=lamp.xyz-world;
                float d2=dot(d,d), edge=max(0.0,1.0-d2/(lamp.w*lamp.w));
                if (hasShadows && lights[i*2+1].w>0.0 && edge>0.0) {
                    vec3 delta=-d+n*0.04, magnitude=abs(delta);
                    int a=magnitude.x>=max(magnitude.y,magnitude.z) ? 0 : magnitude.y>=magnitude.z ? 1 : 2;
                    float major=max(magnitude[a],0.00001);
                    int face=2*a+(delta[a]<0.0 ? 1 : 0);
                    vec2 at=0.5+0.5*vec2(delta[(a+1)%3],-delta[(a+2)%3])/major;
                    at.y=1.0-at.y;
                    int size=textureSize(pointMap,0).x/6;
                    ivec2 texel=ivec2(face,i)*size+clamp(ivec2(at*float(size)),ivec2(0),ivec2(size-1));
                    float bias=0.025+major/float(size);
                    if ((major-bias)/lamp.w>texelFetch(pointMap,texel,0).r) continue;
                }
                light+=lights[i*2+1].rgb*(max(dot(n,d),0.0)*inversesqrt(max(d2,0.0001))*edge*edge/(1.0+d2));
            }
            vec3 linear=clamp(light*vec3((ivec3(rgb)>>ivec3(16,8,0))&255)/255.0,0.0,1.0);
            color=vec4(mix(12.92*linear,1.055*pow(linear,vec3(1.0/2.4))-0.055,greaterThan(linear,vec3(0.0031308))),1);
            gl_FragDepth=t;
            return;
#endif
        }
        // Jump to the far edge of an empty brick. Inside a populated one, an
        // empty 2^3 block is one zero byte of the mask and an empty 4^3 block a
        // zero pair of words, so jump those too; otherwise walk one cell.
        int size=8;
        if (base!=0) {
            size=1;
            if (((mask>>(index&24))&255)==0) size=(mask|word(base+((index>>5)^1)))==0 ? 4 : 2;
        }
        ivec3 low=cell/size*size, edge=low+size*positive;
        vec3 exits=mix((vec3(edge)-origin)*inv,vec3(2),parallel);
        t=min(exits.x,min(exits.y,exits.z));
        pos=origin+t*ray;
        cell=clamp(ivec3(mix(floor(pos),ceil(pos)-1.0,lessThan(ray,vec3(0)))),low,low+size-1);
        bvec3 crossed=equal(exits,vec3(t));
        for (int a=0; a<3; a++) if (crossed[a]) cell[a]=edge[a]+min(stepDir[a],0);
        face=crossed.x ? 0 : crossed.y ? 1 : 2;
    }
    discard;
}

