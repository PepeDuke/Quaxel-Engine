// Build draws in WebGPU's top-left framebuffer coordinates.
function sunShadow(casters,world,sun,size) {
    const toward=[-sun[0],-sun[1],-sun[2]];
    const across=Math.abs(toward[1])>0.99 ? [0,-toward[2],toward[1]] : [toward[2],0,-toward[0]];
    const length=Math.hypot(...across);
    const x=across.map(v=>v/length), z=toward;
    const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
    const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const t=Math.max(0,Math.min(1,Math.abs(world[9])>0.0001 ? -world[13]/world[9] : 0.5));
    const center=[0,1,2].map(i=>world[12+i]+t*world[8+i]);
    const radius=1.5*Math.hypot(...world.subarray(0,3),...world.subarray(4,7));
    const coords=[x,y,z].map(axis=>dot(axis,center));
    const units=2*radius/size;
    coords[0]=Math.round(coords[0]/units)*units;
    coords[1]=Math.round(coords[1]/units)*units;
    let near=coords[2]-radius,far=coords[2]+radius;
    const draws=[];
    for (const caster of casters) {
        let rect=[0,0,size,size];
        if (caster.bounds) {
            const bounds=caster.bounds, half=bounds.subarray(3);
            const range=axis=>Math.abs(axis[0])*half[0]+Math.abs(axis[1])*half[1]+Math.abs(axis[2])*half[2];
            const cx=dot(x,bounds)-coords[0], cy=dot(y,bounds)-coords[1];
            const hx=range(x),hy=range(y);
            if (Math.abs(cx)>radius+hx || Math.abs(cy)>radius+hy) continue;
            const left=Math.max(0,Math.floor((radius+cx-hx)/units));
            const top=Math.max(0,Math.floor((radius+cy-hy)/units));
            const right=Math.min(size,Math.ceil((radius+cx+hx)/units));
            const bottom=Math.min(size,Math.ceil((radius+cy+hy)/units));
            rect=[left,top,right-left,bottom-top];
            const depth=dot(z,bounds),hz=range(z);
            near=Math.min(near,depth-hz);
            far=Math.max(far,depth+hz);
        }
        draws.push({caster,rect});
    }
    const depth=far-near+0.1;
    near-=0.05;
    const origin=x.map((v,i)=>v*coords[0]+y[i]*coords[1]+z[i]*near);
    const worldFromLight=new Float32Array([
        ...x.map(v=>v*radius),0,...y.map(v=>v*radius),0,...z.map(v=>v*depth),0,...origin,1
    ]);
    const lightFromWorld=new Float32Array(16);
    for(let i=0;i<3;i++) {
        lightFromWorld[4*i]=x[i]/(2*radius);
        lightFromWorld[4*i+1]=y[i]/(2*radius);
        lightFromWorld[4*i+2]=z[i]/depth;
    }
    lightFromWorld.set([0.5-coords[0]/(2*radius),0.5-coords[1]/(2*radius),-near/depth,1],12);
    const items=[];
    for (const {caster,rect} of draws) {
        const matrix=new Float32Array(16);
        for(let col=0;col<4;col++) for(let row=0;row<4;row++) {
            let value=0;
            for(let k=0;k<4;k++) value+=caster.matrix[4*k+row]*worldFromLight[4*col+k];
            matrix[4*col+row]=value;
        }
        items.push({handle:caster.handle,matrix,rect,viewport:[0,0,size,size],mode:1});
    }
    return {items,lightFromWorld,bias:Math.max(0.015,units*0.6)/depth};
}

function pointShadows(casters,points,size) {
    const items=[];
    for(let i=0;i<Math.min(points.length,32);i++) {
        const lamp=points[i],radius=lamp[3];
        if (!lamp[7]) continue;
        const candidates=casters.filter(({bounds})=>{
            if (!bounds) return true;
            let distance=0;
            for(let a=0;a<3;a++) distance+=Math.max(0,Math.abs(bounds[a]-lamp[a])-bounds[a+3])**2;
            return distance<radius*radius;
        });
        for(let face=0;face<6;face++) {
            const z=face>>1, x=(z+1)%3,y=(z+2)%3,sign=1-2*(face%2);
            const originX=face*size,originY=i*size;
            for(const {bounds,matrix,handle} of candidates) {
                let x0=0,x1=size,y0=0,y1=size;
                if (bounds) {
                    const depth=sign*(bounds[z]-lamp[z]);
                    const near=depth-bounds[3+z],far=depth+bounds[3+z];
                    if (far<=0 || near>radius) continue;
                    const lx=bounds[x]-lamp[x]-bounds[3+x], rx=lx+2*bounds[3+x];
                    const ty=bounds[y]-lamp[y]-bounds[3+y], by=ty+2*bounds[3+y];
                    if (lx>far || rx< -far || ty>far || by< -far) continue;
                    if (near>0) {
                        const lo=v=>Math.max(0,Math.floor((1+v/(v<0?near:far))*size/2));
                        const hi=v=>Math.min(size,Math.ceil((1+v/(v>0?near:far))*size/2));
                        x0=lo(lx); x1=hi(rx); y0=lo(ty); y1=hi(by);
                    }
                }
                const box=new Float32Array(16);
                for(let row=0;row<3;row++) {
                    box[row]=matrix[4*x+row]*radius;
                    box[row+4]=matrix[4*y+row]*radius;
                    box[row+8]=matrix[4*z+row]*radius*sign;
                    box[row+12]=matrix[row]*lamp[0]+matrix[row+4]*lamp[1]+matrix[row+8]*lamp[2]+matrix[row+12];
                }
                box[15]=1;
                if (x1>x0 && y1>y0) items.push({handle,matrix:box,
                    rect:[originX+x0,originY+y0,x1-x0,y1-y0],viewport:[originX,originY,size,size],mode:2});
            }
        }
    }
    return items;
}
