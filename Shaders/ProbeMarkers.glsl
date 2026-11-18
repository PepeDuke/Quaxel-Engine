// Trace debug spheres only within the resident 8 x 4 x 8 root window.
// The viewer is orthographic. Distances and nearest are in world units.
bool probeMarker(vec3 origin,vec3 dir,int level,inout float nearest) {
    float rootWidth = level == 0 ? 2.0 : 8.0;
    vec3 lo = (floor(focus.xyz/rootWidth)-vec3(4,1,4))*rootWidth;
    vec3 hi = lo+vec3(8,4,8)*rootWidth;
    float enter = 0.0, leave = nearest;
    for (int axis=0; axis<3; ++axis) {
        if (abs(dir[axis]) < 1e-8) {
            if (origin[axis]<lo[axis] || origin[axis]>=hi[axis]) return false;
        } else {
            float a=(lo[axis]-origin[axis])/dir[axis], b=(hi[axis]-origin[axis])/dir[axis];
            enter=max(enter,min(a,b));
            leave=min(leave,max(a,b));
        }
    }
    const float epsilon=0.0001;
    float t=enter+epsilon;
    // At finest resolution a ray crosses at most 64+32+64 grid planes.
    for (int stepIndex=0; stepIndex<164 && t<leave; ++stepIndex) {
        vec3 p=origin+dir*t;
        ivec3 root=ivec3(floor(p/rootWidth));
        int slot=level*256+rootSlot(root);
        float width=rootWidth;
        if (roots[slot].w!=0 && all(equal(roots[slot].xyz,root))) {
            width=rootWidth/8.0;
            int id=probeAt(p,level);
            if (id>=0) {
                vec4 leaf=positions[id];
                width=leaf.w;
                float radius=min(0.14*width,0.04*rootWidth);
                vec3 offset=leaf.xyz-p;
                float along=dot(offset,dir);
                vec3 perp=offset-along*dir;
                float chord=radius*radius-dot(perp,perp);
                if (chord>0.0) {
                    float halfChord=sqrt(chord);
                    float hit=t+max(0.0,along-halfChord);
                    if (along+halfChord>=0.0 && hit<leave) {
                        nearest=hit;
                        return true;
                    }
                }
            }
        }
        vec3 edge=(floor(p/width)+step(vec3(0),dir))*width;
        float advance=leave-t;
        for (int axis=0; axis<3; ++axis)
            if (abs(dir[axis])>=1e-8) advance=min(advance,(edge[axis]-p[axis])/dir[axis]);
        t+=max(0.0,advance)+epsilon;
    }
    return false;
}
