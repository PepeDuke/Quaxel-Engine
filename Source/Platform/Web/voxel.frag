#version 300 es
precision highp float;
precision highp int;
uniform highp isampler2D grid;
uniform ivec2 extent;
uniform mat4 boxFromClip, worldFromClip;
uniform mat3 normals;
uniform vec4 sun, sunlight, sky, ground;
uniform int lightCount;
uniform bool hasShadows;
uniform int shadowPass;
uniform vec2 tileOrigin;
uniform highp sampler2D pointMap;
uniform highp sampler2D shadowMap;
uniform mat4 lightFromWorld;
uniform float shadowBias;
uniform vec4 lights[64];
out vec4 color;

int word(int at) {
    int width = textureSize(grid,0).x;
    return texelFetch(grid,ivec2(at % width,at / width),0).r;
}
int morton(ivec3 p) {
    ivec3 bits = (p & 1) | ((p & 2) << 2) | ((p & 4) << 4);
    return bits.x | (bits.y << 1) | (bits.z << 2);
}

void main() {
    vec2 pixel=gl_FragCoord.xy-tileOrigin;
    vec2 xy = vec2(pixel.x,float(extent.y)-pixel.y)*2.0/vec2(extent)-1.0;
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
    float t=0.0, end=1.0;
    int face=1;
    for (int a=0; a<3; a++) {
        if (parallel[a]) {
            if (origin[a]<0.0 || origin[a]>=float(dims[a])) discard;
        } else {
            float lo=-origin[a]*inv[a], hi=(float(dims[a])-origin[a])*inv[a];
            if (min(lo,hi)>t) { t=min(lo,hi); face=a; }
            end=min(end,max(lo,hi));
        }
    }
    vec3 pos=origin+t*ray;
    ivec3 cell=clamp(ivec3(mix(floor(pos),ceil(pos)-1.0,lessThan(ray,vec3(0)))),ivec3(0),dims-1);
    while (t<end && all(greaterThanEqual(cell,ivec3(0))) && all(lessThan(cell,dims))) {
        ivec3 brick=cell/8;
        int base=word(3+brick.x+bricks.x*(brick.y+bricks.y*brick.z));
        int index=morton(cell & 7);
        if (base!=0 && ((word(base+(index>>5))>>(index&31))&1)!=0) {
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
                    visibility+=step(uv.z-shadowBias*slope*2.0,texture(shadowMap,uv.xy+vec2(sx,sy)*texel).r)/9.0;
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
        }
        // Walk a cell inside a populated brick, jump to the far edge of an empty brick.
        int size=base==0 ? 8 : 1;
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

