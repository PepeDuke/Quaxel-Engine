// Instanced rectangles in the HUD's logical pixel grid, composited over the 3D canvas.
struct Command {
    origin:vec2i, size:vec2i, color:u32, first:u32, last:u32, cell:i32,
}
@group(0) @binding(0) var<storage,read> commands:array<Command>;
@group(0) @binding(1) var<storage,read> atlas:array<u32>;
@group(0) @binding(2) var<uniform> extent:vec2f;
struct Vertex { @builtin(position) position:vec4f, @location(0) @interpolate(flat) index:u32 }
@vertex fn vertex(@builtin(vertex_index) v:u32,@builtin(instance_index) index:u32) -> Vertex {
    let corners=array<vec2i,6>(vec2i(0,0),vec2i(1,0),vec2i(0,1),vec2i(0,1),vec2i(1,0),vec2i(1,1));
    let cmd=commands[index];
    let p=vec2f(cmd.origin+cmd.size*corners[v])/extent;
    return Vertex(vec4f(2*p.x-1,1-2*p.y,0,1),index);
}
fn opaque(cmd:Command,p:vec2i) -> bool {
    if(any(p<vec2i(0)) || any(p>=cmd.size / -cmd.cell)) { return false; }
    return (atlas[cmd.first+u32(p.y)*cmd.last+u32(p.x)]>>24u)!=0u;
}
@fragment fn fragment(in:Vertex) -> @location(0) vec4f {
    let cmd=commands[in.index];
    let local=vec2i(in.position.xy)-cmd.origin;
    var value=cmd.color;
    if(cmd.cell>0) {
        let glyph=vec2u(local/cmd.cell);
        let column=select(cmd.last,cmd.first>>(8u*glyph.x),glyph.x<4u);
        if(((column>>glyph.y)&1u)==0u) { discard; }
    } else if(cmd.cell<0) {
        let p=local / -cmd.cell;
        value=atlas[cmd.first+u32(p.y)*cmd.last+u32(p.x)];
        if((value>>24u)==0u) {
            if(!opaque(cmd,p+vec2i(1,0)) && !opaque(cmd,p-vec2i(1,0)) &&
               !opaque(cmd,p+vec2i(0,1)) && !opaque(cmd,p-vec2i(0,1))) { discard; }
            value=cmd.color;
        }
    }
    return vec4f(vec4u(value>>16u,value>>8u,value,value>>24u)&vec4u(255u))/255.0;
}
