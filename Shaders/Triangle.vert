#version 450
layout(location = 0) out vec3 color;
const vec2 positions[3] = vec2[](vec2(0.0, -0.72), vec2(-0.64, 0.66), vec2(0.64, 0.66));
const vec3 colors[3] = vec3[](vec3(1.0, 0.13, 0.05), vec3(0.06, 0.82, 0.20), vec3(0.08, 0.25, 1.0));
void main() {
    gl_Position = vec4(positions[gl_VertexIndex], 0.0, 1.0);
    color = colors[gl_VertexIndex];
}
