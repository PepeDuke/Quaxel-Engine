int ramp(float t) {
    float middle = clamp(pf(P_MIDDLE_AT), 0.01, 0.99);
    if (t < middle) return mixRgb(pi(P_COLOR_START), pi(P_COLOR_MIDDLE), t / middle);
    return mixRgb(pi(P_COLOR_MIDDLE), pi(P_COLOR_END), (t - middle) / (1.0 - middle));
}

// One workgroup draws one particle. Lanes split the ball's (dx, dy)
// columns; every ball cell is a different grid cell, so each has one writer.
// The streak trail draws over the ball, so ball lanes leave its cells to
// lane 0, which draws the trail last as the serial version did.
void flying(int at, int lane) {
    vec3 pos = rv(at, F_POS);
    ivec3 c = toCell(pos);
    if (!inGrid(c)) return;
    float t = clamp(rf(at, F_AGE) / rf(at, F_LIFE), 0.0, 1.0);
    int rgb = ramp(t);
    float radius = mix(pf(P_SIZE_START), pf(P_SIZE_END), t);
    float density = mix(pf(P_DENSITY_START), pf(P_DENSITY_END), t);
    uint particleSeed = uint(words[at + F_SEED]);
    uint flicker = pi(P_FLICKER) != 0 ? uint(pc.tick) : 0u;
    uint seed = particleSeed ^ (flicker * 2246822519u);
    float shade = pf(P_SHADE);
    float base = 1.0 + (unit(particleSeed) - 0.5) * shade;
    ivec3 trailCells[4];
    int trail = 0;
    float streak = pf(P_STREAK);
    if (streak > 0.0) {
        vec3 vel = rv(at, F_VEL);
        float speed = length(vel);
        trail = min(4, int(speed * streak));
        vec3 back = trail > 0 ? vel * (-pf(P_VOXEL) / speed) : vec3(0.0);
        for (int s = 1; s <= trail; ++s) trailCells[s - 1] = toCell(pos + back * float(s));
    }
    if (radius < 0.5) {
        if (lane == 0 && unit(cellHash(0, 0, 0, seed)) < density) putVoxel(c, scaleRgb(rgb, base));
    } else {
        int reach = min(int(radius) + 1, 8);
        float limit = (radius + 0.25) * (radius + 0.25);
        int width = 2 * reach + 1;
        for (int column = lane; column < width * width; column += 64) {
            int dx = column / width - reach;
            int dy = column % width - reach;
            // Only the dz span that can lie inside the ball, plus a cell of
            // slack against sqrt rounding; the test below still decides, so
            // the cells and their order are the same as for the whole cube.
            float rest = limit - float(dx * dx + dy * dy);
            if (rest < 0.0) continue;
            int span = min(reach, int(sqrt(rest)) + 1);
            for (int dz = -span; dz <= span; ++dz) {
                float distance = float(dx * dx + dy * dy + dz * dz);
                if (distance > limit) continue;
                uint h = cellHash(dx, dy, dz, seed);
                if (unit(h) >= density) continue;
                // Darker toward the rim, so a puff reads as round.
                float rim = 1.0 - 0.25 * sqrt(distance / limit);
                float jitter = 1.0 + (unit(h ^ 0x5bd1e995u) - 0.5) * 2.0 * shade;
                ivec3 cell = c + ivec3(dx, dy, dz);
                bool onTrail = false;
                for (int s = 0; s < trail; ++s) onTrail = onTrail || all(equal(trailCells[s], cell));
                if (!onTrail) putVoxel(cell, scaleRgb(rgb, base * rim * jitter));
            }
        }
    }
    if (lane == 0) {
        for (int s = 1; s <= trail; ++s) putVoxel(trailCells[s - 1], scaleRgb(rgb, base * (1.0 - 0.12 * float(s))));
    }
}

// A ragged patch on the face the drop hit, stretched the way it slid. Cells
// with nothing solid behind them are skipped, so stains stop at edges.
void stain(int at) {
    float seconds = max(0.01, pf(P_STAIN_SECONDS));
    float age = rf(at, F_AGE);
    int rgb = mixRgb(pi(P_STAIN_COLOR), pi(P_STAIN_DRY), age / (seconds * 0.5));
    float fadeFrom = seconds * 0.6;
    float gone = age > fadeFrom ? (age - fadeFrom) / max(0.01, seconds - fadeFrom) : 0.0;
    uint seed = uint(words[at + F_SEED]);
    float vs = pf(P_VOXEL);
    vec3 surface = rv(at, F_POS);
    vec3 normal = rv(at, F_NORMAL);
    vec3 along = normalize(unpackSnorm4x8(uint(words[at + F_ALONG])).xyz);
    vec3 across = cross(normal, along);
    float radius = rf(at, F_RADIUS);
    float stretch = rf(at, F_STRETCH);
    int reachAlong = min(int(radius * stretch) + 1, 12);
    int reachAcross = min(int(radius) + 1, 8);
    for (int a = -reachAlong; a <= reachAlong; ++a)
    for (int b = -reachAcross; b <= reachAcross; ++b) {
        float fa = float(a) / stretch;
        float edge = radius * (0.65 + 0.5 * unit(cellHash(a, b, 0, seed)));
        if (fa * fa + float(b * b) > edge * edge) continue;
        if (unit(cellHash(a, b, 2, seed)) < gone) continue;
        vec3 local = surface + normal * (vs * 0.5) + along * (float(a) * vs) + across * (float(b) * vs);
        // Step up onto a small rise instead of vanishing into it.
        if (solidAt(local)) local += normal * vs;
        if (solidAt(local)) continue;
        if (!solidAt(local - normal * (vs * 1.5))) continue;
        putVoxel(toCell(local), scaleRgb(rgb, 0.8 + 0.35 * unit(cellHash(a, b, 1, seed))));
    }
}

// Dispatched with one workgroup per particle slot.
void main() {
    int i = int(gl_WorkGroupID.x);
    int lane = int(gl_LocalInvocationID.x);
    if (i >= min(pi(P_MAX_PARTICLES), 1024)) return;
    int at = particleAt(i);
    int state = words[at + F_STATE];
    if (state == FLYING) flying(at, lane);
    // Two stain samples can land on one cell, and the later one must win, so
    // a stain stays on one lane.
    else if (state == STUCK && lane == 0) stain(at);
}
