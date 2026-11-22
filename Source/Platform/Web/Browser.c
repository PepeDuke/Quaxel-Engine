#include <emscripten.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <uchar.h>

// Duck strings cross the C ABI as zero-terminated UTF-16.
EM_JS_DEPS(qx_strings, "$UTF16ToString,$FS");
EM_JS(int, persist, (int descriptor), {
    const stream = FS.getStream(descriptor);
    if (stream && stream.isWrite) {
        return Quaxel.save(stream.path, FS.readFile(stream.path));
    }
    return 0;
});
int qx_close(FILE *stream) {
    int result = fflush(stream);
    if (!result) result = persist(fileno(stream));
    return fclose(stream) || result;
}
EM_JS(int, qx_remove, (const char16_t *path), {
    const name = UTF16ToString(Number(path));
    try { FS.unlink(name); return Quaxel.save(name.startsWith('/') ? name : '/' + name, null); }
    catch { return -1; }
});

EM_ASYNC_JS(int, qx_frame, (void), {
    await new Promise(requestAnimationFrame);
    return 1;
});
EM_JS(int, qx_window, (const char16_t *title, int w, int h), {
    document.title = UTF16ToString(Number(title));
    return Quaxel.resize(w,h);
});
EM_JS(int, qx_resize, (int w, int h), { return Quaxel.resize(w,h); });
EM_JS(int, qx_icon, (const char16_t *path), { return Quaxel.icon(UTF16ToString(Number(path)), FS); });
EM_JS(int, qx_input, (int index), { return Quaxel.input(index); });
EM_JS(int, qx_audio, (int action, const short *samples), {
    return Quaxel.audio(action, HEAP16, Number(samples) / 2);
});
EM_JS(int, qx_start, (void), { return Quaxel.graphics.start(); });
// Duck fills one mapping and immediately unmaps it. The GPU owns persistent volume data.
static int *staging;
static int capacity, mapped_words, handles;
static int map_words(int words, void **mapped) {
    *mapped = NULL;
    if (words < 0) return 0;
    if (!staging || capacity < words) {
        int *next = realloc(staging, (size_t)(words ? words : 1) * sizeof(int));
        if (!next) return 0;
        staging = next;
        capacity = words;
    }
    *mapped = staging;
    mapped_words = words;
    return 1;
}
int qx_map(int previous, int words, void **mapped) {
    if (previous >= handles || !map_words(words, mapped)) return -1;
    return previous < 0 ? handles++ : previous;
}
int qx_map_atlas(int words, void **mapped) { return map_words(words, mapped); }
EM_JS(void, qx_upload_words, (int handle, const int *data, int words), {
    const start = Number(data) / 4;
    Quaxel.graphics.upload(handle, HEAP32.subarray(start,start+words));
});
void qx_upload(int handle) {
    qx_upload_words(handle, staging, mapped_words);
}
EM_JS(int, qx_begin, (const float *matrix), {
    return Quaxel.graphics.begin(matrix ? HEAPF32.subarray(Number(matrix)/4,Number(matrix)/4+16) : null);
});
EM_JS(int, qx_trace, (int handle,const float *matrix,float l,float t,float r,float b,const float *axes), {
    return Quaxel.graphics.trace(handle,HEAPF32.slice(Number(matrix)/4,Number(matrix)/4+16),
        l,t,r,b,HEAPF32.slice(Number(axes)/4,Number(axes)/4+9));
});
EM_JS(int, qx_point, (const float *data), {
    Quaxel.graphics.points.push(HEAPF32.slice(Number(data)/4,Number(data)/4+8));
    return 1;
});
EM_JS(int, qx_light, (const float *matrix,const float *lighting), {
    return Quaxel.graphics.light(HEAPF32.subarray(Number(matrix)/4,Number(matrix)/4+16),
        HEAPF32.subarray(Number(lighting)/4,Number(lighting)/4+16));
});
EM_JS(int, qx_ui, (int x,int y,int w,int h,unsigned color,unsigned first,unsigned last,int cell), {
    return Quaxel.graphics.ui(x,y,w,h,color>>>0,first>>>0,last>>>0,cell);
});
EM_JS(int, qx_mesh, (const float *vertices,int n,const uint32_t *indices,int count), {
    return Quaxel.graphics.mesh(HEAPF32.subarray(Number(vertices)/4,Number(vertices)/4+n*6),
        HEAPU32.subarray(Number(indices)/4,Number(indices)/4+count));
});
EM_JS(int, qx_draw, (int mesh,const float *matrix), {
    return Quaxel.graphics.draw(mesh,HEAPF32.subarray(Number(matrix)/4,Number(matrix)/4+16));
});
EM_JS(int, qx_end, (void), { return Quaxel.graphics.end(); });
EM_JS(void, stop_graphics, (void), { Quaxel.graphics.stop(); });

void qx_stop(void) {
    stop_graphics();

    free(staging);
    staging = NULL;
    handles = capacity = 0;
}

EM_JS(int, qx_caster, (int handle, const float *matrix, const float *bounds), {
    const offset=Number(matrix)/4;
    Quaxel.graphics.casters.push({handle,matrix:HEAPF32.slice(offset,offset+16),
        bounds:bounds ? HEAPF32.slice(Number(bounds)/4,Number(bounds)/4+6) : null});
    return 1;
});

EM_JS(int, qx_pages, (int pages), { return Quaxel.graphics.ensurePages(pages); });
EM_JS(int, qx_reset, (int slot), { return Quaxel.graphics.resetEffect(slot); });
EM_JS(int, qx_params, (int slot,const void *data,int bytes), {
    return Quaxel.graphics.effectParams(slot,HEAPU8.subarray(Number(data),Number(data)+bytes));
});
EM_JS(int, qx_bake, (int slot,int volume,const float *matrix,int x,int y,int z), {
    return Quaxel.graphics.bake(slot,volume,HEAPF32.subarray(Number(matrix)/4,Number(matrix)/4+16),x,y,z);
});
EM_JS(int, qx_simulate, (int slot,int step,float seconds), {
    return Quaxel.graphics.simulate(slot,step,seconds);
});
EM_JS(int, qx_stamp, (int slot,int tick), { return Quaxel.graphics.stamp(slot,tick); });
EM_ASYNC_JS(int, qx_read_slot, (int slot,int words,void *destination), {
    if (!destination) return 0;
    const result=await Quaxel.graphics.readSlot(slot,words);
    if (!result) return 0;
    HEAPU32.set(result,Number(destination)/4);
    return 1;
});
