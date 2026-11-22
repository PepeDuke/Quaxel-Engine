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
struct Volume { int *data; int words; };
static struct Volume *volumes, atlas;
static int handles, capacity;

static int map(struct Volume *volume, int words, void **mapped) {
    *mapped = NULL;
    if (words < 0) return 0;
    int *next = realloc(volume->data, (words ? (size_t)words : 1) * sizeof(int));
    if (!next) return 0;
    volume->data = *mapped = next;
    volume->words = words;
    return 1;
}
int qx_map(int previous, int words, void **mapped) {
    if (previous >= handles) return -1;
    if (previous < 0 && handles == capacity) {
        int size = capacity ? 2 * capacity : 64;
        struct Volume *next = realloc(volumes, size * sizeof(*volumes));
        if (!next) return -1;
        volumes = next;
        capacity = size;
    }
    int handle = previous < 0 ? handles : previous;
    if (previous < 0) volumes[handle] = (struct Volume){0};
    if (!map(&volumes[handle], words, mapped)) return -1;
    if (previous < 0) handles++;
    return handle;
}
int qx_map_atlas(int words, void **mapped) { return map(&atlas, words, mapped); }
const int *qx_volume(int handle) {
    return handle >= 0 && handle < handles ? volumes[handle].data : NULL;
}
EM_JS(void, qx_upload_words, (int handle, const int *data, int words), {
    const start = Number(data) / 4;
    Quaxel.graphics.upload(handle, HEAP32.subarray(start,start+words));
});
void qx_upload(int handle) {
    struct Volume *volume = handle < 0 ? &atlas : &volumes[handle];
    qx_upload_words(handle, volume->data, volume->words);
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
void qx_stop_effects(void);
void qx_stop(void) {
    stop_graphics();
    qx_stop_effects();
    for (int i = 0; i < handles; i++) free(volumes[i].data);
    free(volumes);
    free(atlas.data);
    volumes = NULL;
    atlas = (struct Volume){0};
    handles = capacity = 0;
}

EM_JS(int, qx_caster, (int handle, const float *matrix, const float *bounds), {
    const offset=Number(matrix)/4;
    Quaxel.graphics.casters.push({handle,matrix:HEAPF32.slice(offset,offset+16),
        bounds:bounds ? HEAPF32.slice(Number(bounds)/4,Number(bounds)/4+6) : null});
    return 1;
});
