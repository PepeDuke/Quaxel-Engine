@vertex fn fullscreen(@builtin(vertex_index) index:u32) -> @builtin(position) vec4f {
    let p=vec2f(f32((index<<1u)&2u),f32(index&2u));
    return vec4f(p*2.0-1.0,0,1);
}
struct MeshTransforms { projection:mat4x4f, model:mat4x4f }
@group(0) @binding(0) var<uniform> transforms:MeshTransforms;
struct VertexOutput { @builtin(position) position:vec4f, @location(0) color:vec3f }
@vertex fn meshVertex(@location(0) position:vec3f,@location(1) color:vec3f) -> VertexOutput {
    let p=transforms.projection*transforms.model*vec4f(position,1);
    return VertexOutput(vec4f(p.x,-p.y,p.z,p.w),color);
}
@fragment fn meshColor(in:VertexOutput) -> @location(0) vec4f { return vec4f(in.color,1); }
