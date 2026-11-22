class BrowserGraphics {
    constructor(scene,overlay) {
        this.scene = scene;
        this.overlay = overlay;
        this.ctx = overlay.getContext('2d');
        this.textures = new Map();
        this.meshes = [];
        this.sprites = new Map();
        this.traces = [];
        this.points = [];
        this.casters = [];
    }
    program(vertex,fragment) {
        const gl = this.gl, program = gl.createProgram();
        for (const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader,source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
            gl.attachShader(program,shader);
            gl.deleteShader(shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
        const uniforms = {};
        for (let i=0; i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS); i++) {
            const name = gl.getActiveUniform(program,i).name;
            uniforms[name.replace('[0]','')] = gl.getUniformLocation(program,name);
        }
        return {program,uniforms};
    }
    start() {
        this.gl = this.scene.getContext('webgl2',{alpha:false,antialias:false});
        if (!this.gl) throw Error('WebGL 2 is unavailable');
        this.voxel = this.program(`#version 300 es
            void main() {
                vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);
                gl_Position=vec4(p*2.0-1.0,0,1);
            }`,this.fragment);
        this.shadow = new SunShadow(this.gl);
        this.pointShadows = new PointShadows(this.gl);
        this.triangle = this.program(`#version 300 es
            layout(location=0) in vec3 position;
            layout(location=1) in vec3 rgb;
            uniform mat4 projection, model;
            out vec3 v;
            void main() {
                vec4 p=projection*model*vec4(position,1);
                gl_Position=vec4(p.x,-p.y,2.0*p.z-p.w,p.w); v=rgb;
            }`,`#version 300 es
            precision highp float;
            in vec3 v; out vec4 color;
            void main() { color=vec4(v,1); }`);
        return 1;
    }
    upload(handle,words) {
        if (handle<0) {
            this.atlas = words.slice();
            this.sprites.clear();
            return;
        }
        const gl=this.gl, width=Math.min(1024,words.length), height=Math.ceil(words.length/width);
        if (!width || height>gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw Error('Volume exceeds WebGL texture capacity');
        const texture=this.textures.get(handle) || gl.createTexture();
        this.textures.set(handle,texture);
        gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        const full=Math.floor(words.length/width), tail=words.length%width;
        gl.texImage2D(gl.TEXTURE_2D,0,gl.R32I,width,height,0,gl.RED_INTEGER,gl.INT,null);
        if (full) gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,width,full,gl.RED_INTEGER,gl.INT,words);
        if (tail) gl.texSubImage2D(gl.TEXTURE_2D,0,0,full,tail,1,gl.RED_INTEGER,gl.INT,words.subarray(full*width));
    }
    begin(matrix) {
        const gl=this.gl, {width,height}=this.scene;
        this.points.length=this.traces.length=this.casters.length=0;
        this.projection=matrix?.slice();
        gl.viewport(0,0,width,height);
        gl.disable(gl.SCISSOR_TEST);
        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0.012,0.018,0.03,1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.ctx.clearRect(0,0,this.overlay.width,this.overlay.height);
        this.ctx.imageSmoothingEnabled=false;
        return !gl.isContextLost();
    }
    trace(handle,matrix,l,t,r,b,axes) {
        this.traces.push({handle,matrix,l,t,r,b,axes});
        return 1;
    }
    light(world,lighting) {
        const gl=this.gl, u=this.voxel.uniforms, {width,height}=this.scene;
        gl.useProgram(this.voxel.program);
        const count=Math.min(this.points.length,32);
        gl.uniform1i(u.shadowMap,1);
        gl.uniform1i(u.pointMap,2);
        gl.uniform1i(u.hasShadows,Number(this.casters.length>0));
        if (this.casters.length) {
            this.shadow.render(this,world,lighting);
            if (this.points.some(p=>p[7])) this.pointShadows.render(this,count);
        }
        gl.uniformMatrix4fv(u.worldFromClip,false,world);
        gl.uniform2i(u.extent,width,height);
        for (const [i,key] of ['sun','sunlight','sky','ground'].entries())
            gl.uniform4fv(u[key],lighting.subarray(4*i,4*i+4));
        gl.uniform1i(u.lightCount,count);
        if (count) {
            const lamps=new Float32Array(count*8);
            for(let i=0;i<count;i++) lamps.set(this.points[i],i*8);
            gl.uniform4fv(u.lights,lamps);
        }
        gl.enable(gl.SCISSOR_TEST);
        for (const item of this.traces) {
            const x=Math.floor(item.l*width), top=Math.floor(item.t*height), bottom=Math.ceil(item.b*height);
            gl.scissor(x,height-bottom,Math.ceil(item.r*width)-x,bottom-top);
            gl.uniformMatrix4fv(u.boxFromClip,false,item.matrix);
            gl.uniformMatrix3fv(u.normals,false,item.axes);
            gl.bindTexture(gl.TEXTURE_2D,this.textures.get(item.handle));
            gl.drawArrays(gl.TRIANGLES,0,3);
        }
        gl.disable(gl.SCISSOR_TEST);
        return 1;
    }
    ui(x,y,w,h,color,first,last,cell) {
        const ctx=this.ctx;
        ctx.fillStyle='#'+((color&0xffffff)*256+(color>>>24)).toString(16).padStart(8,'0');
        if (!cell) ctx.fillRect(x,y,w,h);
        else if (cell>0) {
            for(let col=0; col<5; col++) {
                let bits=col===4 ? last : first>>>(8*col);
                for(let row=0; row<7; row++) if(bits&(1<<row)) ctx.fillRect(x+col*cell,y+row*cell,cell,cell);
            }
        } else {
            const width=w/-cell,height=h/-cell,key=[first,last,width,height,color].join('/');
            let sprite=this.sprites.get(key);
            if (!sprite) {
                sprite=new OffscreenCanvas(width,height);
                const context=sprite.getContext('2d'), pixels=context.createImageData(width,height);
                const value=(i,j)=>i>=0 && j>=0 && i<width && j<height ? this.atlas[first+j*last+i] : 0;
                for(let j=0; j<height; j++) for(let i=0; i<width; i++) {
                    let c=value(i,j);
                    if (!(c>>>24) && ((value(i-1,j)|value(i+1,j)|value(i,j-1)|value(i,j+1))>>>24)) c=color;
                    const at=(i+j*width)*4;
                    pixels.data[at]=(c>>>16)&255;
                    pixels.data[at+1]=(c>>>8)&255;
                    pixels.data[at+2]=c&255;
                    pixels.data[at+3]=c>>>24;
                }
                context.putImageData(pixels,0,0);
                this.sprites.set(key,sprite);
            }
            ctx.drawImage(sprite,x,y,w,h);
        }
        return 1;
    }
    mesh(vertices,indices) {
        const gl=this.gl, vao=gl.createVertexArray();
        gl.bindVertexArray(vao);
        const vertex=gl.createBuffer(), index=gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER,vertex);
        gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
        for(let i=0;i<2;i++) {
            gl.enableVertexAttribArray(i);
            gl.vertexAttribPointer(i,3,gl.FLOAT,false,24,i*12);
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
        gl.bindVertexArray(null);
        return this.meshes.push({vao,vertex,index,count:indices.length})-1;
    }
    draw(id,model) {
        const mesh=this.meshes[id],gl=this.gl;
        if (!mesh || !this.projection) return 0;
        gl.useProgram(this.triangle.program);
        gl.uniformMatrix4fv(this.triangle.uniforms.model,false,model);
        gl.uniformMatrix4fv(this.triangle.uniforms.projection,false,this.projection);
        gl.bindVertexArray(mesh.vao);
        gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_INT,0);
        gl.bindVertexArray(null);
        return 1;
    }
    end() {
        document.querySelector('#status').hidden=true;
        return !this.gl.isContextLost();
    }
    stop() {
        const gl=this.gl;
        if (!gl) return;
        for (const texture of this.textures.values()) gl.deleteTexture(texture);
        this.textures.clear();
        for (const mesh of this.meshes) {
            gl.deleteVertexArray(mesh.vao);
            gl.deleteBuffer(mesh.vertex);
            gl.deleteBuffer(mesh.index);
        }
        this.meshes.length=0;
        this.shadow?.stop();
        this.pointShadows?.stop();
        this.atlas=null;
        this.sprites.clear();
        for (const shader of [this.voxel,this.triangle]) if (shader) gl.deleteProgram(shader.program);
    }
}
