// Frame constants are packed on the CPU, uploaded once per page and indexed
// by dynamic offsets. Never overwrite constants used by another draw in flight.
class FrameUniforms {
    constructor(device) {
        this.device=device;
        this.pages=[];
        this.stride=Math.max(256,device.limits.minUniformBufferOffsetAlignment);
    }
    begin() { this.count=0; }
    allocate() {
        const index=this.count++;
        const pageIndex=Math.floor(index/256),offset=(index%256)*this.stride;
        if (!this.pages[pageIndex]) {
            const size=256*this.stride,bytes=new Uint8Array(size);
            this.pages.push({bytes,floats:new Float32Array(bytes.buffer),ints:new Int32Array(bytes.buffer),
                buffer:this.device.createBuffer({
                label:'Frame constants',size,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC
            })});
        }
        // Views span the whole page; at is this record's first 32-bit word.
        // Each record owns 64 words from there.
        const page=this.pages[pageIndex];
        return {buffer:page.buffer,offset,at:offset/4,floats:page.floats,ints:page.ints,bytes:page.bytes};
    }
    upload() {
        for(let p=0;p*256<this.count;p++) {
            const page=this.pages[p],size=Math.min(256,this.count-p*256)*this.stride;
            this.device.queue.writeBuffer(page.buffer,0,page.bytes,0,size);
        }
    }
    destroy() { for(const page of this.pages) page.buffer.destroy(); }
}

// Display > Performance stats (or ?profile) shows which GPU the browser chose,
// CPU time per frame and, where timestamp queries exist, GPU time per pass.
// Players can read it out on their own hardware; it costs nothing while hidden.
class GpuProfiler {
    constructor(device,adapter,timestamps) {
        this.device=device;
        this.enabled=false;
        this.capacity=128;
        if (timestamps) {
            this.set=device.createQuerySet({type:'timestamp',count:this.capacity});
            this.resolve=device.createBuffer({size:this.capacity*8,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
        }
        this.cpu=0;
        this.cpuStart=0;
        const raf=requestAnimationFrame.bind(window);
        window.requestAnimationFrame=callback=>{
            if (this.cpuStart) { this.cpu+=performance.now()-this.cpuStart; this.cpuStart=0; }
            return raf(time=>{ this.cpuStart=performance.now(); callback(time); });
        };
        this.reads=[];
        this.totals={};
        this.samples=0;
        this.frames=0;
        this.since=performance.now();
        this.labels=[];
        const info=adapter.info||{};
        this.adapter=[info.vendor,info.architecture,info.description].filter(Boolean).join(' ')||'unknown adapter';
        this.view=document.createElement('pre');
        this.view.hidden=true;
        this.view.style.cssText='position:fixed;left:8px;top:8px;margin:0;padding:6px 9px;background:#000b;color:#cfe;font:12px monospace;pointer-events:none;z-index:2;user-select:text';
        document.body.append(this.view);
    }
    show(enabled) {
        this.enabled=enabled;
        this.view.hidden=!enabled;
        this.view.textContent='Measuring…';
        this.totals={}; this.samples=this.frames=0; this.cpu=0; this.since=performance.now();
    }
    begin() { this.labels=[]; }
    writes(label) {
        if (!this.enabled || !this.set || 2*this.labels.length+2>this.capacity) return undefined;
        const index=2*this.labels.length;
        this.labels.push(label);
        return {querySet:this.set,beginningOfPassWriteIndex:index,endOfPassWriteIndex:index+1};
    }
    finish(encoder) {
        this.pending=null;
        const count=2*this.labels.length;
        if (!count) return;
        const read=this.reads.pop()||this.device.createBuffer({size:this.capacity*8,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
        encoder.resolveQuerySet(this.set,0,count,this.resolve,0);
        encoder.copyBufferToBuffer(this.resolve,0,read,0,count*8);
        this.pending={read,labels:this.labels};
    }
    submitted(scene,lights,casters,traces) {
        if (!this.enabled) return;
        this.frames++;
        this.stats=`${scene.width}x${scene.height} @${devicePixelRatio}x  traces ${traces}  casters ${casters}  lights ${lights}`;
        const pending=this.pending;
        if (pending) pending.read.mapAsync(GPUMapMode.READ).then(()=>{
            const times=new BigInt64Array(pending.read.getMappedRange(),0,2*pending.labels.length);
            const frame={};
            pending.labels.forEach((label,i)=>{ frame[label]=(frame[label]||0)+Math.max(0,Number(times[2*i+1]-times[2*i]))/1e6; });
            for (const label in frame) this.totals[label]=(this.totals[label]||0)+frame[label];
            this.samples++;
            pending.read.unmap();
            this.reads.push(pending.read);
        },()=>{});
        const now=performance.now(),elapsed=now-this.since;
        if (elapsed<1000) return;
        const pacing=new URLSearchParams(location.search).has('uncapped')?'uncapped':'vsync';
        const lines=[this.adapter,this.stats,`${(this.frames*1000/elapsed).toFixed(1)} fps (${pacing})  ${(elapsed/this.frames).toFixed(2)} ms/frame`,
            `${'CPU'.padEnd(14)}${(this.cpu/this.frames).toFixed(2).padStart(7)} ms`];
        if (!this.set) lines.push('GPU timing unavailable in this browser');
        let gpu=0;
        for (const [label,total] of Object.entries(this.totals).sort((a,b)=>b[1]-a[1])) {
            const ms=total/Math.max(1,this.samples);
            gpu+=ms;
            lines.push(`${label.padEnd(14)}${ms.toFixed(2).padStart(7)} ms`);
        }
        lines.push(`${'GPU total'.padEnd(14)}${gpu.toFixed(2).padStart(7)} ms`);
        this.view.textContent=lines.join('\n');
        this.totals={};
        this.samples=this.frames=0;
        this.cpu=0;
        this.since=now;
    }
}

class BrowserGraphics {
    constructor(scene,overlay) {
        this.scene=scene;
        this.overlay=overlay;
        this.uiWords=new Int32Array(4096);
        this.volumes=new Map();
        // Occupied bricks per volume handle, packed as voxel.frag reads them.
        this.bounds=new Map();
        this.meshes=[];
        this.points=[];
        this.casters=[];
        this.traces=[];
        this.draws=[];
        this.capacity=0;
    }
    async initialize(fetchOk,fail) {
        if (!navigator.gpu) throw Error('WebGPU is unavailable. Open the game over HTTPS or localhost in a WebGPU-capable browser.');
        const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
        if (!adapter) throw Error('The browser could not find a WebGPU adapter.');
        const timestamps=adapter.features.has('timestamp-query');
        const device=this.device=await adapter.requestDevice(timestamps?{requiredFeatures:['timestamp-query']}:undefined);
        this.profiler=new GpuProfiler(device,adapter,timestamps);
        const report=message=>{
            this.failed=true;
            fail(message);
        };
        device.lost.then(info=>report('WebGPU device lost: '+info.message));
        device.addEventListener('uncapturederror',e=>report(e.error.message));
        this.context=this.scene.getContext('webgpu');
        this.uiContext=this.overlay.getContext('webgpu');
        this.format=navigator.gpu.getPreferredCanvasFormat();

        const load=async name=>{
            const response=await fetchOk('Shaders/'+name+'.wgsl');
            const module=device.createShaderModule({label:name,code:await response.text()});
            const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
            if(errors.length) throw Error(name+' shader: '+errors.map(e=>e.lineNum+' '+e.message).join('\n'));
            return module;
        };
        const names=['Voxel','VoxelShadow','Mesh','Ui','EffectBake','EffectSim','EffectClear','EffectStamp','EffectBricks'];
        const modules=Object.fromEntries(await Promise.all(names.map(async n=>[n,await load(n)])));
        const frag=GPUShaderStage.FRAGMENT,compute=GPUShaderStage.COMPUTE;
        const binding=(binding,visibility,type,dynamic=false)=>({binding,visibility,buffer:{type,hasDynamicOffset:dynamic}});
        this.drawLayout=device.createBindGroupLayout({entries:[binding(0,frag,'read-only-storage'),binding(1,frag,'uniform',true)]});
        this.frameLayout=device.createBindGroupLayout({entries:[binding(0,frag,'uniform'),...[1,2].map(i=>({
            binding:i,visibility:frag,texture:{sampleType:'depth'}
        }))]});
        this.effectLayouts=[false,true].map(bake=>device.createBindGroupLayout({entries:[
            binding(0,compute,'storage'),binding(1,compute,'uniform',true),
            ...(bake?[binding(2,compute,'read-only-storage')]:[])
        ]}));
        const layout=(...groups)=>device.createPipelineLayout({bindGroupLayouts:groups});
        const depthStencil={format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'};
        const vertex={module:modules.Mesh,entryPoint:'fullscreen'};
        const createVoxel=(shadow)=>device.createRenderPipelineAsync({
            label:shadow?'Voxel shadows':'Voxel lighting',layout:shadow?layout(this.drawLayout):layout(this.drawLayout,this.frameLayout),
            vertex,depthStencil,fragment:{module:shadow?modules.VoxelShadow:modules.Voxel,entryPoint:'main',
                targets:shadow?[]:[{format:this.format}]}
        });
        this.meshLayout=device.createBindGroupLayout({entries:[binding(0,GPUShaderStage.VERTEX,'uniform',true)]});
        const mesh=device.createRenderPipelineAsync({label:'Meshes',layout:layout(this.meshLayout),depthStencil,
            vertex:{module:modules.Mesh,entryPoint:'meshVertex',buffers:[{arrayStride:24,attributes:[
                {shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}
            ]}]},fragment:{module:modules.Mesh,entryPoint:'meshColor',targets:[{format:this.format}]}});
        const ui=this.device.createRenderPipelineAsync({label:'HUD',layout:'auto',
            vertex:{module:modules.Ui,entryPoint:'vertex'},fragment:{module:modules.Ui,entryPoint:'fragment',
                targets:[{format:this.format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},
                    alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]}});
        this.effects={};
        [this.voxel,this.shadow,this.triangle,this.hud]=await Promise.all([createVoxel(false),createVoxel(true),mesh,ui]);
        await Promise.all(['Bake','Sim','Clear','Stamp','Bricks'].map(async name=>{
            this.effects[name]=await device.createComputePipelineAsync({label:'Effect '+name,
                layout:layout(this.effectLayouts[Number(name==='Bake')]),compute:{module:modules['Effect'+name],entryPoint:'main'}});
        }));
    }
    depth(width,height,label) {
        return this.device.createTexture({label,size:[width,height],format:'depth24plus',
            usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    }
    start() {
        if (this.failed) return 0;
        this.context.configure({device:this.device,format:this.format,alphaMode:'opaque'});
        this.uiContext.configure({device:this.device,format:this.format,alphaMode:'premultiplied'});
        this.uiExtent=this.device.createBuffer({size:8,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
        this.upload(-1,new Int32Array(1));
        this.uniforms=new FrameUniforms(this.device);
        this.sunMap=this.depth(1024,1024,'Sun shadows');
        this.pointMap=this.depth(384,2048,'Point shadows');
        this.frameData=new Float32Array(308);
        this.frameBuffer=this.device.createBuffer({size:this.frameData.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
        this.frameGroup=this.device.createBindGroup({layout:this.frameLayout,entries:[
            {binding:0,resource:{buffer:this.frameBuffer}},{binding:1,resource:this.sunMap.createView()},{binding:2,resource:this.pointMap.createView()}
        ]});
        return 1;
    }
    createVolume(handle,size) {
        const buffer=this.device.createBuffer({size,label:'Voxel volume '+handle,
            usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
        const volume={buffer,groups:new Map(),computeGroups:new Map()};
        this.volumes.get(handle)?.buffer.destroy();
        this.volumes.set(handle,volume);
        return volume;
    }
    upload(handle,words) {
        if (!words.length) return;
        this.bounds.delete(handle); // Until the engine reports the new contents.
        let volume=this.volumes.get(handle);
        if (!volume || volume.buffer.size<words.byteLength) volume=this.createVolume(handle,words.byteLength);
        this.device.queue.writeBuffer(volume.buffer,0,words);
    }
    setBounds(handle,low,high) { this.bounds.set(handle,[low,high]); }
    begin(matrix) {
        if (this.failed) return 0;
        this.points.length=this.traces.length=this.casters.length=this.draws.length=0;
        this.projection=matrix?.slice();
        this.uniforms.begin();
        this.profiler?.begin();
        this.encoder=this.device.createCommandEncoder();
        this.uiCount=0;
        const {width,height}=this.scene;
        if (!this.sceneDepth || width!==this.sceneDepth.width || height!==this.sceneDepth.height) {
            this.sceneDepth?.destroy();
            this.sceneDepth=this.depth(width,height,'Scene depth');
        }
        this.target=this.context.getCurrentTexture().createView();
        this.sceneDrawn=false;
        return 1;
    }
    trace(handle,matrix,l,t,r,b,axes) {
        const {width,height}=this.scene,x=Math.floor(l*width),y=Math.floor(t*height);
        this.traces.push({handle,matrix,axes,rect:[x,y,Math.ceil(r*width)-x,Math.ceil(b*height)-y],
            viewport:[0,0,width,height],mode:0});
        return 1;
    }
    renderPass(texture,items,shadow,label) {
        this.endCompute();
        const pass=this.encoder.beginRenderPass({timestampWrites:this.profiler?.writes(label),
            colorAttachments:shadow?[]:[{view:this.target,clearValue:{r:.012,g:.018,b:.03,a:1},loadOp:'clear',storeOp:'store'}],
            depthStencilAttachment:{view:texture.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}
        });
        pass.setPipeline(shadow?this.shadow:this.voxel);
        if (!shadow) pass.setBindGroup(1,this.frameGroup);
        for(const item of items) {
            const {handle,matrix,axes,viewport,rect,mode}=item;
            if (rect[2]<=0 || rect[3]<=0) continue;
            const record=this.uniforms.allocate(),floats=record.floats,at=record.at;
            if (item.lightFromBox) multiplyInto(floats,at,item.lightFromBox,matrix);
            else floats.set(matrix,at);
            if (axes) for(let i=0;i<3;i++) for(let j=0;j<3;j++) floats[at+16+i*4+j]=axes[i*3+j];
            floats[at+28]=viewport[0]; floats[at+29]=viewport[1]; floats[at+30]=viewport[2]; floats[at+31]=viewport[3];
            record.ints[at+32]=mode;
            const bounds=this.bounds.get(handle);
            record.ints[at+33]=bounds?bounds[0]:0;
            record.ints[at+34]=bounds?bounds[1]:0;
            const volume=this.volumes.get(handle);
            let group=volume.groups.get(record.buffer);
            if (!group) {
                group=this.device.createBindGroup({layout:this.drawLayout,entries:[
                    {binding:0,resource:{buffer:volume.buffer}},{binding:1,resource:{buffer:record.buffer,size:144}}
                ]});
                volume.groups.set(record.buffer,group);
            }
            pass.setViewport(...viewport,0,1);
            pass.setScissorRect(...rect);
            pass.setBindGroup(0,group,[record.offset]);
            pass.draw(3);
        }
        pass.end();
    }
    light(world,lighting) {
        const sun=sunShadow(this.casters,world,lighting,this.sunMap.width);
        const points=pointShadows(this.casters,this.points,this.pointMap.width/6);
        this.renderPass(this.sunMap,sun.items,true,'sun shadows');
        this.renderPass(this.pointMap,points,true,'point shadows');
        const data=this.frameData,ints=new Int32Array(data.buffer);
        data.set(world); data.set(sun.lightFromWorld,16); data.set(lighting,32);
        const count=Math.min(this.points.length,32);
        for(let i=0;i<count;i++) data.set(this.points[i],48+i*8);
        data[304]=sun.bias; ints[305]=count; ints[306]=Number(this.casters.length>0);
        this.device.queue.writeBuffer(this.frameBuffer,0,data);
        this.renderPass(this.sceneDepth,this.traces,false,'scene');
        this.sceneDrawn=true;
        return 1;
    }
    mesh(vertices,indices) {
        const create=(data,usage)=>{
            const buffer=this.device.createBuffer({size:data.byteLength,usage:usage|GPUBufferUsage.COPY_DST});
            this.device.queue.writeBuffer(buffer,0,data);
            return buffer;
        };
        return this.meshes.push({vertex:create(vertices,GPUBufferUsage.VERTEX),index:create(indices,GPUBufferUsage.INDEX),count:indices.length})-1;
    }
    draw(id,model) {
        if (!this.meshes[id] || !this.projection) return 0;
        this.draws.push({mesh:this.meshes[id],model:model.slice()});
        return 1;
    }
    end() {
        this.endCompute();
        if (!this.sceneDrawn || this.draws.length) {
            const loadOp=this.sceneDrawn?'load':'clear';
            const pass=this.encoder.beginRenderPass({timestampWrites:this.profiler?.writes('meshes'),colorAttachments:[{view:this.target,loadOp,storeOp:'store',clearValue:{r:.012,g:.018,b:.03,a:1}}],
                depthStencilAttachment:{view:this.sceneDepth.createView(),depthLoadOp:loadOp,depthStoreOp:'store',depthClearValue:1}});
            pass.setPipeline(this.triangle);
            for(const {mesh,model} of this.draws) {
                const record=this.uniforms.allocate();
                record.floats.set(this.projection,record.at); record.floats.set(model,record.at+16);
                const group=this.device.createBindGroup({layout:this.meshLayout,entries:[{binding:0,resource:{buffer:record.buffer,size:128}}]});
                pass.setBindGroup(0,group,[record.offset]);
                pass.setVertexBuffer(0,mesh.vertex); pass.setIndexBuffer(mesh.index,'uint32');
                pass.drawIndexed(mesh.count);
            }
            pass.end();
        }
        this.renderHud();
        this.uniforms.upload();
        this.profiler?.finish(this.encoder);
        this.device.queue.submit([this.encoder.finish()]);
        this.profiler?.submitted(this.scene,this.points.length,this.casters.length,this.traces.length);
        this.encoder=null;
        if (!this.failed) document.querySelector('#status').hidden=true;
        return !this.failed;
    }
    ensurePages(pages) {
        if (pages<0 || pages>16) return 0;
        this.capacity=Math.max(this.capacity,pages*8);
        return 1;
    }
    slot(slot) { return this.volumes.get(0x40000000+slot); }
    resetEffect(slot) {
        if (!this.encoder || slot<0 || slot>=this.capacity) return 0;
        const volume=this.slot(slot) || this.createVolume(0x40000000+slot,295808*4);
        this.endCompute();
        this.encoder.clearBuffer(volume.buffer);
        const record=this.uniforms.allocate();
        record.ints[record.at]=record.ints[record.at+1]=record.ints[record.at+2]=64;
        this.endCompute();
        this.encoder.copyBufferToBuffer(record.buffer,record.offset,volume.buffer,0,12);
        return 1;
    }
    effectParams(slot,bytes) {
        const volume=this.slot(slot);
        if (!volume || bytes.length!==160) return 0;
        const record=this.uniforms.allocate();
        record.bytes.set(bytes,record.offset);
        this.endCompute();
        this.encoder.copyBufferToBuffer(record.buffer,record.offset,volume.buffer,295680*4,160);
        return 1;
    }
    dispatch(name,slot,record,groups,grid=null) {
        const volume=this.slot(slot);
        if (!volume) return 0;
        // Groups depend only on buffers, so each combination is made once.
        const key=grid?grid.buffer:record.buffer;
        let byRecord=volume.computeGroups.get(record.buffer);
        if (!byRecord) volume.computeGroups.set(record.buffer,byRecord=new Map());
        let group=byRecord.get(key);
        if (!group) {
            const entries=[{binding:0,resource:{buffer:volume.buffer}},{binding:1,resource:{buffer:record.buffer,size:96}}];
            if (grid) entries.push({binding:2,resource:{buffer:grid.buffer}});
            group=this.device.createBindGroup({layout:this.effectLayouts[Number(Boolean(grid))],entries});
            byRecord.set(key,group);
        }
        // Dispatches in one pass still see each other's writes, in order.
        if (!this.computePass) this.computePass=this.encoder.beginComputePass({timestampWrites:this.profiler?.writes('effects')});
        const pass=this.computePass;
        pass.setPipeline(this.effects[name]);
        pass.setBindGroup(0,group,[record.offset]);
        pass.dispatchWorkgroups(groups[0],groups[1]??1,groups[2]??1);
        return 1;
    }
    endCompute() {
        this.computePass?.end();
        this.computePass=null;
    }
    bake(slot,handle,matrix,x,y,z) {
        const grid=this.volumes.get(handle);
        if (!grid) return 0;
        const record=this.uniforms.allocate();
        const at=record.at;
        record.floats.set(matrix,at); record.ints[at+16]=0;
        record.ints[at+20]=x; record.ints[at+21]=y; record.ints[at+22]=z;
        return this.dispatch('Bake',slot,record,[16,16,16],grid);
    }
    simulate(slot,step,seconds) {
        const record=this.uniforms.allocate();
        const at=record.at;
        record.ints[at+16]=0; record.ints[at+17]=step; record.floats[at+18]=seconds;
        return this.dispatch('Sim',slot,record,[16]);
    }
    stamp(slot,tick) {
        const record=this.uniforms.allocate();
        record.ints[record.at+16]=0; record.ints[record.at+19]=tick;
        return this.dispatch('Clear',slot,record,[512]) && this.dispatch('Stamp',slot,record,[1024]) && this.dispatch('Bricks',slot,record,[512]);
    }
    async readSlot(slot,count) {
        const volume=this.slot(slot);
        if (this.encoder || !volume || count<=0 || count*4>volume.buffer.size) return null;
        const read=this.device.createBuffer({size:count*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        try {
            const encoder=this.device.createCommandEncoder();
            encoder.copyBufferToBuffer(volume.buffer,0,read,0,count*4);
            this.device.queue.submit([encoder.finish()]);
            await read.mapAsync(GPUMapMode.READ);
            return new Uint32Array(read.getMappedRange()).slice();
        } finally { read.destroy(); }
    }
    stop() {
        for(const volume of this.volumes.values()) volume.buffer.destroy();
        for(const mesh of this.meshes) { mesh.vertex.destroy(); mesh.index.destroy(); }
        this.volumes.clear(); this.meshes.length=0; this.uiExtent?.destroy(); this.uiBuffer?.destroy(); this.uiBuffer=null;
        this.uniforms?.destroy(); this.frameBuffer?.destroy();
        this.sceneDepth?.destroy(); this.sunMap?.destroy(); this.pointMap?.destroy();
        this.encoder=null; this.computePass=null; this.sceneDepth=null; this.capacity=0;
        this.context?.unconfigure();
        this.uiContext?.unconfigure();
    }
    ui(x,y,w,h,color,first,last,cell) {
        const at=this.uiCount*8;
        if (at===this.uiWords.length) {
            const next=new Int32Array(at*2);
            next.set(this.uiWords);
            this.uiWords=next;
        }
        this.uiWords.set([x,y,w,h,color,first,last,cell],at);
        this.uiCount++;
        return 1;
    }
    renderHud() {
        const pass=this.encoder.beginRenderPass({timestampWrites:this.profiler?.writes('hud'),colorAttachments:[{view:this.uiContext.getCurrentTexture().createView(),
            loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
        if (this.uiCount) {
            if (!this.uiBuffer || this.uiBuffer.size<this.uiCount*32) {
                this.uiBuffer?.destroy();
                this.uiBuffer=this.device.createBuffer({size:this.uiWords.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
            }
            this.device.queue.writeBuffer(this.uiBuffer,0,this.uiWords,0,this.uiCount*8);
            this.device.queue.writeBuffer(this.uiExtent,0,new Float32Array([this.overlay.width,this.overlay.height]));
            const group=this.device.createBindGroup({layout:this.hud.getBindGroupLayout(0),entries:[
                {binding:0,resource:{buffer:this.uiBuffer}},{binding:1,resource:{buffer:this.volumes.get(-1).buffer}},
                {binding:2,resource:{buffer:this.uiExtent}}
            ]});
            pass.setPipeline(this.hud);
            pass.setBindGroup(0,group);
            pass.draw(6,this.uiCount);
        }
        pass.end();
    }
}
