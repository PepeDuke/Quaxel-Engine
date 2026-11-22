const Quaxel = {
    graphics: new BrowserGraphics(document.querySelector('#scene'), document.querySelector('#overlay')),
    state: new Int32Array(264),
    audioContext: null,
    nextAudio: 0,
    requestedWidth: 960,
    requestedHeight: 540,
    renderScale: '1',

    input(index) {
        const value = this.state[index];
        if (index === 260 || index === 263) this.state[index] = 0;
        return value;
    },
    resize(w,h) {
        if (w < 1 || h < 1) return 0;
        this.requestedWidth = w;
        this.requestedHeight = h;
        this.fit();
        return 1;
    },
    fit() {
        const height = Math.min(innerHeight, this.requestedHeight);
        const width = Math.round(height * innerWidth / Math.max(innerHeight,1));
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
                fetchOk('assets.gz').then(r=>new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()),
                this.graphics.initialize(fetchOk,fail)
            ]);
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
