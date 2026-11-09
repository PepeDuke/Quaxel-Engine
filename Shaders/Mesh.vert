#version 450
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 vertexColor;
layout(location = 0) out vec3 color;
layout(push_constant) uniform Transforms {
    mat4 model;
    mat4 viewProjection;
} transforms;
void main() {
    gl_Position = transforms.viewProjection * transforms.model * vec4(position, 1.0);
    color = vertexColor;
}
