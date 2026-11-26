const Quaxel = {
    graphics: new BrowserGraphics(document.querySelector('#scene'), document.querySelector('#overlay')),
    state: new Int32Array(264),
    audioContext: null,
    nextAudio: 0,
    requestedWidth: 960,
    requestedHeight: 540,
    renderScale: '1',

    // Copies held state into the game's memory. Wheel notches and the stall
    // flag accumulate there until the game reads them.
    copyInput(heap, at) {
        const state = this.state;
        heap.set(state.subarray(0, 260), at);
        heap[at + 260] += state[260];
        heap[at + 261] = state[261];
        heap[at + 262] = state[262];
        heap[at + 263] |= state[263];
        state[260] = state[263] = 0;
    },
    resize(w,h) {
        if (w < 1 || h < 1) return 0;
        this.requestedWidth = w;
        this.requestedHeight = h;
        this.fit();
        return 1;
    },
    fit() {
        // A hidden or collapsed iframe reports a 0x0 viewport; WebGPU rejects empty textures.
        const height = Math.max(1, Math.min(innerHeight, this.requestedHeight));
        const width = Math.max(1, Math.round(height * innerWidth / Math.max(innerHeight,1)));
        const {scene,overlay} = this.graphics;
        if (overlay.width !== width) overlay.width = width;
        if (overlay.height !== height) overlay.height = height;
        const scale = devicePixelRatio * Number(this.renderScale);
        const sceneWidth = this.renderScale === 'game' ? width : Math.max(1, Math.round(innerWidth * scale));
        const sceneHeight = this.renderScale === 'game' ? height : Math.max(1, Math.round(innerHeight * scale));
        if (scene.width !== sceneWidth) scene.width = sceneWidth;
        if (scene.height !== sceneHeight) scene.height = sceneHeight;
        this.state[261] = width;
        this.state[262] = height;
    },
    bindDisplay(game) {
        const select = document.querySelector('#render-scale');
        const key = 'quaxel-settings/' + game + '/render-scale';
        const saved = localStorage.getItem(key);
        if (Array.from(select.options).some(option => option.value === saved)) select.value = saved;
        this.renderScale = select.value;
        select.addEventListener('change', () => {
            this.renderScale = select.value;
            this.fit();
            localStorage.setItem(key, select.value);
        });
        const watchPixelRatio = () => {
            this.fit();
            matchMedia('(resolution: ' + devicePixelRatio + 'dppx)')
                .addEventListener('change', watchPixelRatio, {once:true});
        };
        watchPixelRatio();
        // The Performance stats checkbox is commented out in shell.html. Without
        // it only ?profile shows the overlay, and a setting saved by it is ignored.
        const profile = new URLSearchParams(location.search).has('profile');
        const stats = document.querySelector('#performance-stats');
        const statsKey = 'quaxel-settings/' + game + '/performance-stats';
        if (stats) {
            stats.checked = profile || localStorage.getItem(statsKey) === '1';
            stats.addEventListener('change', () => { showStats(); localStorage.setItem(statsKey, stats.checked ? '1' : '0'); });
        }
        const showStats = () => this.graphics.profiler?.show(stats ? stats.checked : profile);
        this.showStats = showStats;
        document.querySelector('#display').addEventListener('focusin', () => this.state.fill(0,0,258));
    },
    bindInput() {
        const canvas = this.graphics.scene;
        const keys = this.state;
        const unlock = () => {
            if (!this.audioContext) this.audioContext = new AudioContext();
            if (this.audioContext.state === 'suspended') this.audioContext.resume().catch(console.warn);
        };
        for (const event of ['keydown','keyup']) addEventListener(event, e => {
            if (e.target.closest?.('#display')) return;
            if (e.metaKey || e.ctrlKey || e.keyCode >= 112 && e.keyCode <= 123) return;
            if (e.type === 'keydown') unlock();
            keys[e.keyCode & 255] = Number(e.type === 'keydown');
            e.preventDefault();
        });
        const pointer = e => {
            const rect = canvas.getBoundingClientRect();
            keys[258] = Math.floor((e.clientX - rect.left) * this.state[261] / rect.width);
            keys[259] = Math.floor((e.clientY - rect.top) * this.state[262] / rect.height);
            keys[256] = Number(Boolean(e.buttons & 1));
            keys[257] = Number(Boolean(e.buttons & 2));
        };
        canvas.onpointerdown = e => { unlock(); canvas.setPointerCapture(e.pointerId); pointer(e); };
        canvas.onpointermove = canvas.onpointerup = pointer;
        canvas.onpointercancel = () => keys.fill(0,256,258);
        canvas.oncontextmenu = e => e.preventDefault();
        canvas.addEventListener('wheel', e => {
            keys[260] -= Math.sign(e.deltaY);
            e.preventDefault();
        }, {passive:false});
        addEventListener('blur', () => { keys.fill(0,0,258); keys[263] = 1; });
        document.addEventListener('visibilitychange', () => { keys[263] = 1; });
        addEventListener('resize', () => this.fit());
    },
    audio(action, heap, offset) {
        const ctx = this.audioContext;
        if (action === 3) { this.nextAudio = 0; return 1; }
        if (action === 0) return 1;
        if (action === 1) return Number(ctx?.state === 'running' && this.nextAudio < ctx.currentTime + 0.075);
        if (!ctx || ctx.state !== 'running') return 0;
        const buffer = ctx.createBuffer(2,800,48000);
        for (let ch=0; ch<2; ch++) {
            const channel = buffer.getChannelData(ch);
            for (let i=0; i<800; i++) channel[i] = heap[offset + 2*i + ch]/32768;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        this.nextAudio = Math.max(ctx.currentTime,this.nextAudio);
        source.start(this.nextAudio);
        this.nextAudio += buffer.duration;
        return 1;
    },
    icon(path,fs) {
        try {
            const icon = document.querySelector("link[rel=icon]") || document.createElement('link');
            if (icon.href.startsWith('blob:')) URL.revokeObjectURL(icon.href);
            icon.rel = 'icon';
            icon.href = URL.createObjectURL(new Blob([fs.readFile(path)]));
            document.head.append(icon);
            return 1;
        } catch { return 0; }
    },
    save(path, bytes) {
        try {
            if (bytes === null) localStorage.removeItem(this.prefix + path);
            else localStorage.setItem(this.prefix + path, bytes.toBase64());
            return 0;
        } catch (error) { console.error('Saving',path,error); return -1; }
    },
    async launch(game) {
        const status = document.querySelector('#status');
        const fail = error => { status.hidden=false; status.textContent=String(error); console.error(error); };
        addEventListener('error', e => fail(e.message));
        addEventListener('unhandledrejection', e => fail(e.reason));
        try {
            if (!WebAssembly.Suspending) throw Error('This game requires a browser with WebAssembly stack switching and Memory64.');
            this.prefix = 'quaxel/' + game + '/';
            this.bindDisplay(game);
            this.bindInput();
            const fetchOk = async url => {
                const response = await fetch(url, {cache:'no-cache'});
                if (!response.ok) throw Error(url + ' returned ' + response.status);
                return response;
            };
            const [index, pack] = await Promise.all([
                fetchOk('assets.json').then(r=>r.json()),
                // Hosts such as itch.io serve gzip files with Content-Encoding: gzip, so the
                // browser may already have decompressed the pack. Only gunzip if the magic bytes remain.
                fetchOk('assets.gz').then(r=>r.arrayBuffer()).then(bytes => {
                    const head = new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
                    if (head[0] !== 0x1f || head[1] !== 0x8b) return bytes;
                    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
                }),
                this.graphics.initialize(fetchOk,fail)
            ]);
            this.showStats();
            status.textContent = 'Preparing ' + game + '…';
            window.Module = {
                arguments: new URLSearchParams(location.search).getAll('arg'),
                onAbort: fail,
                onExit: code => {
                    if (this.graphics.failed) return;
                    status.hidden=false;
                    status.textContent=game + ' closed (' + code + ')';
                },
                preRun: [module => {
                    const fs = module.FS;
                    let offset = 0;
                    const install = (path,bytes) => {
                        fs.mkdirTree(path.substring(0,path.lastIndexOf('/')) || '/');
                        fs.writeFile(path,bytes,{canOwn:true});
                    };
                    for (const [path,size] of index) {
                        install('/'+path, new Uint8Array(pack,offset,size));
                        offset += size;
                    }
                    if (offset !== pack.byteLength) throw Error('Asset package length mismatch');
                    for (const key of Object.keys(localStorage)) {
                        if (key.startsWith(this.prefix)) install(key.slice(this.prefix.length),Uint8Array.fromBase64(localStorage.getItem(key)));
                    }
                }]
            };
            const loader = document.createElement('script');
            loader.src = game + '.js';
            loader.onerror = () => fail('Could not load '+loader.src);
            document.body.append(loader);
        } catch (error) { fail(error); }
    }
};

// ?uncapped paces frames by the GPU instead of the display refresh, so the
// stats overlay measures what the renderer can do. Each frame waits for the
// GPU work submitted two frames before it, as an uncapped native renderer
// keeps two frames in flight. Frames past the refresh rate are not all shown.
// A message, unlike setTimeout(0), is not clamped to 4 ms, and still lets
// input and audio events run between frames.
if (new URLSearchParams(location.search).has('uncapped')) {
    const submitted = [];
    const waiting = [];
    const channel = new MessageChannel();
    channel.port1.onmessage = () => waiting.shift()?.(performance.now());
    window.requestAnimationFrame = callback => {
        const queue = Quaxel.graphics.device?.queue;
        if (queue) submitted.push(queue.onSubmittedWorkDone());
        const previous = submitted.length > 2 ? submitted.shift() : Promise.resolve();
        previous.then(() => {
            waiting.push(callback);
            channel.port2.postMessage(0);
        });
        return 0;
    };
}
