bool sunBlocked(vec3 start, vec3 sun, int casterCount) {
    int slot = -1;
    if (sunWindow.w != 0) {
        vec2 ground = (start.xz - start.y * (sun.xz / sun.y)) / SUN_CHUNK;
        ivec2 chunk = ivec2(floor(ground));
        ivec2 offset = chunk - sunWindow.xy;
        if (all(greaterThanEqual(offset, ivec2(0))) && all(lessThan(offset, ivec2(8)))) {
            slot = sunSlot(chunk);
            if (chunkTops[slot >> 2][slot & 3] < -1e29) return false;
            vec2 local = fract(ground) * SUN_SIZE - 0.5;
            ivec2 p = ivec2(floor(local));
            if (all(greaterThanEqual(p, ivec2(0))) && all(lessThan(p, ivec2(SUN_SIZE - 1)))) {
                int at = sunTexel(slot, p);
                vec2 a = vec2(depthAtlas[at], depthAtlas[at + 1]);
                vec2 b = vec2(depthAtlas[at + SUN_SIZE], depthAtlas[at + SUN_SIZE + 1]);
                float h = start.y * sign(sun.y);
                float tolerance = SUN_CHUNK / SUN_SIZE;
                if (h > max(max(a.x, a.y), max(b.x, b.y)) + tolerance) return false;
                if (h < min(min(a.x, a.y), min(b.x, b.y)) - tolerance) return true;
            }
        }
    }
    // Keep descriptor indices uniform even where adjacent pixels use different chunks.
    for (int w = 0; w * 32 < casterCount; ++w) {
        uint mask = slot < 0 ? ~0u : sunMask(slot, w);
        if (mask == 0u) continue;
        for (int bit = 0; bit < 32 && w * 32 + bit < casterCount; ++bit) {
            if ((mask & (1u << bit)) != 0u && firstHit(w * 32 + bit, start, sun, FAR) < FAR) return true;
        }
    }
    return false;
}
