// --- Globals, Helpers, DOM Elements ---
// Wrap entire script in an IIFE to avoid polluting the global namespace
(function () {
    let pyodide = null;
    let htmlMonaco, cssMonaco, scriptMonaco;
    let htmlLangSelect, cssLangSelect, scriptLangSelect;

    // DOM Element Selectors
    const cmdPanel = document.getElementById('command-prompt-panel');
    const cmdOutput = document.getElementById('command-output');
    const cmdInput = document.getElementById('command-input');
    const cmdToggleButton = document.getElementById('cmd-toggle-button');
    const consoleOutputPyElement = document.getElementById('console-output-py');
    const loadingIndicator = document.getElementById('loading-indicator');
    const loadingDetails = document.getElementById('loading-details');
    const previewFrame = document.getElementById('preview-frame');
    const iframeContainer = document.getElementById('iframe-container');
    const outputConsoleContainer = document.getElementById('output-console-container');
    const toastNotification = document.getElementById('toast-notification');
    const shareButton = document.getElementById('share-button');
    const GITHUB_API_URL = 'https://api.github.com/gists';

    // --- IMPROVEMENT: On-Demand Transpiler Loading ---
    // This manager loads scripts like Babel, TypeScript, and SASS only when needed,
    // dramatically speeding up the initial load time.
    const TranspilerManager = {
        loaded: new Map(),
        urls: {
            babel: 'https://unpkg.com/@babel/standalone@7.23.4/babel.min.js',
            typescript: 'https://cdnjs.cloudflare.com/ajax/libs/typescript/5.3.3/typescript.min.js',
            marked: 'https://cdnjs.cloudflare.com/ajax/libs/marked/4.2.12/marked.min.js',
            sass: 'https://cdnjs.cloudflare.com/ajax/libs/sass.js/0.11.1/sass.sync.min.js'
        },
        get(name) {
            if (!this.urls[name]) {
                return Promise.reject(new Error(`Transpiler ${name} not defined.`));
            }
            if (!this.loaded.has(name)) {
                const promise = new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = this.urls[name];
                    script.onload = () => {
                        console.log(`${name} script loaded.`);
                        appendCmdOutput(`${name} loaded on-demand.`, 'info');
                        // sass.js requires special handling to get the instance
                        if (name === 'sass') {
                            Sass.setWorkerUrl( 'https://cdnjs.cloudflare.com/ajax/libs/sass.js/0.11.1/sass.worker.min.js');
                            this.loaded.set(name, new Sass());
                        } else {
                            this.loaded.set(name, window[name] || true);
                        }
                        resolve(this.loaded.get(name));
                    };
                    script.onerror = () => {
                        console.error(`${name} script failed to load.`);
                        appendCmdOutput(`Failed to load ${name} script.`, 'error');
                        reject(new Error(`Script load error for ${this.urls[name]}`));
                    };
                    document.body.appendChild(script);
                });
                this.loaded.set(name, promise); // Store the promise to prevent multiple requests
                return promise;
            }
            // If it's already loaded or being loaded, return the promise/value
            return Promise.resolve(this.loaded.get(name));
        }
    };
    
    // --- Built-in Code Presets Definition (unchanged) ---
    const codePresets = { html: { '!': `<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>Document</title>\n</head>\n<body>\n    $CURSOR$\n</body>\n</html>`, 'table': `<table>\n    <thead>\n        <tr>\n            <th>Header 1</th>\n            <th>Header 2</th>\n        </tr>\n    </thead>\n    <tbody>\n        <tr>\n            <td>$CURSOR$Data 1</td>\n            <td>Data 2</td>\n        </tr>\n    </tbody>\n</table>`, 'link:css': '<link rel="stylesheet" href="style.css">', 'script:src': '<script src="app.js" defer>$CURSOR$<\/script>' }, css: { 'bg': 'background-color: $CURSOR#', 'btn': `.button {\n    display: inline-block;\n    padding: 10px 20px;\n    font-size: 16px;\n    cursor: pointer;\n    text-align: center;\n    color: #fff;\n    background-color: #4CAF50;\n    border: none;\n    border-radius: 15px;\n}\n.button:hover {background-color: #3e8e41}$CURSOR$`, 'flex': `display: flex;\nalign-items: center;\njustify-content: center;$CURSOR$` }, javascript: { 'log': 'console.log($CURSOR$);', 'fun': `function functionName($CURSOR$) {\n    // code block\n}`, 'for': `for (let i = 0; i < array.length; i++) {\n    const element = array[i];\n    $CURSOR$\n}`, 'fetch': `fetch('https://api.example.com/data')\n    .then(response => response.json())\n    .then(data => {\n        console.log(data);\n        $CURSOR$\n    })\n    .catch(error => console.error('Error fetching data:', error));` }, typescript: { 'interface': `interface NewInterface {\n    property: string;\n    $CURSOR$\n}`, 'type': `type NewType = {\n    id: number;\n    name: string;\n    $CURSOR$\n};`, 'comp': `import React from 'react';\n\nconst NewComponent = (props) => {\n    return (\n        <div>\n            $CURSOR$\n        </div>\n    );\n};\n\nexport default NewComponent;`, 'useState': `const [value, setValue] = React.useState($CURSOR$initialValue);` }, jsx: { 'comp': `import React from 'react';\n\nconst NewComponent = (props) => {\n    return (\n        <div>\n            $CURSOR$\n        </div>\n    );\n};\n\nexport default NewComponent;`, 'useState': `const [value, setValue] = React.useState($CURSOR$initialValue);` }, python: { 'def': `def new_function(arg1, arg2):\n    # function body\n    $CURSOR$\n    pass`, 'class': `class NewClass:\n    def __init__(self$CURSOR$):\n        pass\n\n    def method(self):\n        pass`, 'for': `for item in iterable:\n    # process item\n    $CURSOR$\n    pass` } };
    const defaultCodes = { html: `<h1>Hello, Polyglot!</h1>\n<p>Start typing HTML or select Markdown.</p>\n<!-- Try the resizer in the middle! -->`, markdown: `# Start Typing Markdown!`, css: `body {\n    font-family: sans-serif;\n    padding: 10px;\n    background-color: #f0f0f0;\n}`, scss: `// SCSS here\n$primary-color: #7a5af5;\nbody { h1 { color: $primary-color; } }`, javascript: `// JavaScript here\nconsole.log('Hello from Polyglot JavaScript!');`, typescript: `// TypeScript here\nconst message: string = "Hello from Polyglot TypeScript!";\nconsole.log(message);`, jsx: `// React (JSX) here\nconst App = () => (\n    <div>\n        <h1>Hello from React (JSX)!</h1>\n    </div>\n);\n`, python: `# Python here\nprint("Hello from Python via Pyodide!")`};

    // --- Helper Functions (largely unchanged) ---
    function triggerDownload(blob, filename) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(link.href); }
    function appendCmdOutput(text, type = 'normal') { const line = document.createElement('div'); line.classList.add('cmd-line'); if (type === 'error') line.classList.add('cmd-error'); else if (type === 'success') line.classList.add('cmd-success'); else if (type === 'info') line.classList.add('cmd-info'); else if (type === 'warn') line.classList.add('cmd-warn'); line.textContent = text; cmdOutput.appendChild(line); cmdOutput.scrollTop = cmdOutput.scrollHeight; }
    function debounce(func, wait) { let timeout; return (...args) => { const later = () => { clearTimeout(timeout); func(...args); }; clearTimeout(timeout); timeout = setTimeout(later, wait); }; }
    function getMonacoLangId(langKey) { switch(langKey) { case 'html': return 'html'; case 'markdown': return 'markdown'; case 'css': return 'css'; case 'scss': return 'scss'; case 'javascript': return 'javascript'; case 'typescript': return 'typescript'; case 'jsx': return 'typescript'; case 'python': return 'python'; default: return 'plaintext'; } }
    function showToast(message = "Link copied to clipboard!", duration = 3000) { toastNotification.textContent = message; toastNotification.classList.add('show'); setTimeout(() => { toastNotification.classList.remove('show'); }, duration); }

    // --- Snippet Manager (unchanged) ---
    const SNIPPET_STORAGE_KEY = 'polyglotUserSnippets_v1';
    const SnippetManager = {
        snippets: [],
        loadSnippets: function() { try { const storedSnippets = localStorage.getItem(SNIPPET_STORAGE_KEY); this.snippets = storedSnippets ? JSON.parse(storedSnippets) : []; } catch (e) { console.error("Error loading snippets:", e); this.snippets = []; } this.snippets.forEach(s => { if (typeof s.isEnabled === 'undefined') s.isEnabled = true; }); return this.snippets; },
        saveSnippets: function() { try { localStorage.setItem(SNIPPET_STORAGE_KEY, JSON.stringify(this.snippets)); } catch (e) { console.error("Error saving snippets:", e); appendCmdOutput("Error saving snippets. Storage might be full.", "error"); } },
        generateId: function() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); },
        addSnippet: function(snippetData) { if (!snippetData.trigger || !snippetData.template || !snippetData.language) { appendCmdOutput("Snippet data incomplete.", "error"); return false; } if (this.isTriggerTaken(snippetData.trigger, snippetData.language)) { appendCmdOutput(`Trigger '${snippetData.trigger}' already exists for ${snippetData.language}.`, "error"); showToast(`Trigger '${snippetData.trigger}' already exists.`, 4000); return false; } const newSnippet = { id: this.generateId(), trigger: snippetData.trigger.trim(), template: snippetData.template, language: snippetData.language, isUserDefined: true, isEnabled: true, createdAt: new Date().toISOString() }; this.snippets.push(newSnippet); this.saveSnippets(); appendCmdOutput(`Snippet '${newSnippet.trigger}' for ${newSnippet.language} added.`, "success"); return true; },
        updateSnippet: function(snippetId, updatedData) { const index = this.snippets.findIndex(s => s.id === snippetId); if (index === -1) { appendCmdOutput("Snippet not found for update.", "error"); return false; } if (updatedData.trigger && this.isTriggerTaken(updatedData.trigger, updatedData.language || this.snippets[index].language, snippetId)) { appendCmdOutput(`Trigger '${updatedData.trigger}' already exists.`, "error"); showToast(`Trigger '${updatedData.trigger}' already exists.`, 4000); return false; } this.snippets[index] = { ...this.snippets[index], ...updatedData, trigger: updatedData.trigger.trim() }; this.saveSnippets(); appendCmdOutput(`Snippet '${this.snippets[index].trigger}' updated.`, "success"); return true; },
        deleteSnippet: function(snippetId) { const initialLength = this.snippets.length; this.snippets = this.snippets.filter(s => s.id !== snippetId); if (this.snippets.length < initialLength) { this.saveSnippets(); appendCmdOutput("Snippet deleted.", "success"); return true; } appendCmdOutput("Snippet not found.", "error"); return false; },
        toggleSnippetEnabled: function(snippetId) { const index = this.snippets.findIndex(s => s.id === snippetId); if (index > -1) { this.snippets[index].isEnabled = !this.snippets[index].isEnabled; this.saveSnippets(); renderUserSnippetsList(); appendCmdOutput(`Snippet '${this.snippets[index].trigger}' ${this.snippets[index].isEnabled ? 'enabled' : 'disabled'}.`, "info"); } },
        getSnippetsByLanguage: function(language) { return this.snippets.filter(s => s.language === language && s.isUserDefined && s.isEnabled); },
        getAllUserSnippets: function() { return [...this.snippets.filter(s => s.isUserDefined)]; },
        isTriggerTaken: function(trigger, language, excludeId = null) { return this.snippets.some(s => s.language === language && s.trigger.toLowerCase() === trigger.toLowerCase() && s.id !== excludeId); },
        exportSnippets: function() { const userSnippets = this.getAllUserSnippets().map(({id, createdAt, isUserDefined, ...rest}) => rest); if (userSnippets.length === 0) { showToast("No user snippets to export.", 3000); return; } const jsonString = JSON.stringify(userSnippets, null, 2); const blob = new Blob([jsonString], { type: 'application/json' }); triggerDownload(blob, 'polyglot-studio-snippets.json'); appendCmdOutput("User snippets exported.", "success"); },
        importSnippets: function(file) { const reader = new FileReader(); reader.onload = (event) => { try { const imported = JSON.parse(event.target.result); if (!Array.isArray(imported)) throw new Error("Invalid snippet array."); let importedCount = 0, skippedCount = 0; imported.forEach(s => { if (s.trigger && s.template && s.language) { if (!this.isTriggerTaken(s.trigger, s.language)) { this.addSnippet({ trigger: s.trigger, template: s.template, language: s.language }); importedCount++; } else { skippedCount++; appendCmdOutput(`Skipped importing '${s.trigger}' for ${s.language} (trigger taken).`, "warn"); } } else { appendCmdOutput("Skipped invalid snippet object.", "warn"); } }); renderUserSnippetsList(); showToast(`${importedCount} snippets imported. ${skippedCount} skipped.`, 4000); appendCmdOutput(`${importedCount} imported. ${skippedCount} skipped.`, "info"); } catch (e) { console.error("Error importing snippets:", e); appendCmdOutput(`Import error: ${e.message}`, "error"); showToast("Failed to import. Invalid JSON.", 4000); } }; reader.onerror = () => { appendCmdOutput("Error reading import file.", "error"); showToast("Error reading file.", 3000); }; reader.readAsText(file); }
    };
    SnippetManager.loadSnippets();
    // Snippet Modal DOM Elements and Functions (unchanged logic)
    const snippetModal = document.getElementById('snippet-manager-modal');
    const manageSnippetsButton = document.getElementById('manage-snippets-button');
    const closeSnippetModalButton = document.getElementById('close-snippet-modal');
    const createNewSnippetButton = document.getElementById('create-new-snippet-button');
    const snippetEditorFormContainer = document.getElementById('snippet-editor-form-container');
    const snippetForm = document.getElementById('snippet-form');
    const snippetFormTitle = document.getElementById('snippet-form-title');
    const snippetIdInput = document.getElementById('snippet-id-input');
    const snippetLanguageInput = document.getElementById('snippet-language-input');
    const snippetTriggerInput = document.getElementById('snippet-trigger-input');
    const snippetTemplateInput = document.getElementById('snippet-template-input');
    const saveSnippetButton = document.getElementById('save-snippet-button');
    const cancelSnippetEditButton = document.getElementById('cancel-snippet-edit-button');
    const userSnippetsListDiv = document.getElementById('user-snippets-list');
    const exportSnippetsButton = document.getElementById('export-snippets-button');
    const importSnippetsInput = document.getElementById('import-snippets-input');
    function openSnippetModal() { SnippetManager.loadSnippets(); renderUserSnippetsList(); snippetEditorFormContainer.style.display = 'none'; snippetModal.style.display = 'block'; }
    function closeSnippetModal() { snippetModal.style.display = 'none'; snippetForm.reset(); snippetIdInput.value = ''; }
    function showSnippetForm(snippet = null) { snippetForm.reset(); snippetIdInput.value = ''; if (snippet) { snippetFormTitle.textContent = 'Edit'; snippetIdInput.value = snippet.id; snippetLanguageInput.value = snippet.language; snippetTriggerInput.value = snippet.trigger; snippetTemplateInput.value = snippet.template; } else { snippetFormTitle.textContent = 'Create New'; const activeScriptLang = typeof scriptLangSelect !== 'undefined' && scriptLangSelect ? scriptLangSelect.value : 'javascript'; snippetLanguageInput.value = activeScriptLang; } snippetEditorFormContainer.style.display = 'block'; }
    function renderUserSnippetsList() { const snippets = SnippetManager.getAllUserSnippets(); userSnippetsListDiv.innerHTML = ''; if (snippets.length === 0) { userSnippetsListDiv.innerHTML = '<p>No custom snippets. Click "Create New" to add one.</p>'; return; } const groupedByLanguage = snippets.reduce((acc, snippet) => { (acc[snippet.language] = acc[snippet.language] || []).push(snippet); return acc; }, {}); Object.keys(groupedByLanguage).sort().forEach(lang => { const langHeader = document.createElement('h4'); langHeader.textContent = lang.charAt(0).toUpperCase() + lang.slice(1); langHeader.style.cssText = 'margin-top:15px;border-bottom:1px solid var(--border-dark);padding-bottom:5px;'; userSnippetsListDiv.appendChild(langHeader); groupedByLanguage[lang].forEach(s => { const item = document.createElement('div'); item.className = 'snippet-item'; item.innerHTML = `<div class="snippet-info"><span class="trigger">${s.trigger}</span><span class="language">${s.language}</span>${s.isEnabled ? '' : '<span class="language" style="background-color:var(--accent-red);color:white;">Disabled</span>'}</div><div class="snippet-item-actions"><button class="edit-btn" data-id="${s.id}">Edit</button><button class="toggle-btn" data-id="${s.id}">${s.isEnabled ? 'Disable' : 'Enable'}</button><button class="delete-btn" data-id="${s.id}">Delete</button></div>`; userSnippetsListDiv.appendChild(item); }); }); userSnippetsListDiv.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', (e) => { const snippetToEdit = SnippetManager.getAllUserSnippets().find(s => s.id === e.target.dataset.id); if (snippetToEdit) showSnippetForm(snippetToEdit); })); userSnippetsListDiv.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', (e) => { if (confirm('Delete snippet?')) { SnippetManager.deleteSnippet(e.target.dataset.id); renderUserSnippetsList(); } })); userSnippetsListDiv.querySelectorAll('.toggle-btn').forEach(btn => btn.addEventListener('click', (e) => SnippetManager.toggleSnippetEnabled(e.target.dataset.id))); }

    // --- State Serialization & Sharing (unchanged logic) ---
    async function serializeState() { if (!htmlMonaco || !cssMonaco || !scriptMonaco) { console.error("Editors not initialized."); return null; } return { hL: htmlLangSelect.value, hC: htmlMonaco.getValue(), cL: cssLangSelect.value, cC: cssMonaco.getValue(), sL: scriptLangSelect.value, sC: scriptMonaco.getValue(), v: 2 }; }
    async function handleShareButtonClick() { loadingIndicator.style.display = 'flex'; loadingDetails.textContent = "Generating link..."; const state = await serializeState(); if (!state) { showToast("Error: Editors not ready.", 3000); loadingIndicator.style.display = 'none'; return; } const jsonState = JSON.stringify(state); let shareUrl = ''; try { const compressedState = LZString.compressToEncodedURIComponent(jsonState); const potentialUrl = `${window.location.origin}${window.location.pathname}#${compressedState}`; if (potentialUrl.length < 2000) { shareUrl = potentialUrl; } else { appendCmdOutput("Compressed code too long, trying Gist...", "info"); shareUrl = await createGistForState(jsonState); } } catch (e) { appendCmdOutput(`Error compressing state: ${e}`, "error"); showToast("Error generating link.", 3000); loadingIndicator.style.display = 'none'; return; } if (!shareUrl) { appendCmdOutput("Failed to create Gist.", "error"); showToast("Error creating Gist.", 4000); loadingIndicator.style.display = 'none'; return; } try { await navigator.clipboard.writeText(shareUrl); showToast("Link copied!"); appendCmdOutput(`Share link: ${shareUrl}`, "success"); } catch (err) { appendCmdOutput(`Failed to copy: ${err}`, "error"); showToast("Failed to copy. See console.", 3000); window.prompt("Copy this link:", shareUrl); } loadingIndicator.style.display = 'none'; }
    async function createGistForState(jsonState) { try { const payload = { description: "Polyglot Studio Shared Code", public: true, files: { 'polyglot-studio-data.json': { content: jsonState } } }; const headers = { 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }; const response = await fetch(GITHUB_API_URL, { method: 'POST', headers: headers, body: JSON.stringify(payload) }); if (!response.ok) { const errorData = await response.json(); throw new Error(`GitHub API Error: ${response.status} - ${errorData.message || 'Failed to create Gist'}`); } const gistData = await response.json(); if (gistData.id) { return `${window.location.origin}${window.location.pathname}?gist=${gistData.id}`; } throw new Error("Gist ID not found."); } catch (error) { appendCmdOutput(`Gist error: ${error.message}`, "error"); console.error("Gist error:", error); return null; } }
    async function loadState(state) { if (!state || typeof state !== 'object') { console.error("Invalid state."); return; } if (!htmlMonaco || !cssMonaco || !scriptMonaco) { appendCmdOutput("Editors not ready, retrying load...", "warn"); setTimeout(() => loadState(state), 500); return; } loadingIndicator.style.display = 'flex'; loadingDetails.textContent = "Loading shared code..."; try { htmlLangSelect.value = state.hL || 'html'; cssLangSelect.value = state.cL || 'css'; scriptLangSelect.value = state.sL || 'javascript'; setEditorLanguage(htmlMonaco, htmlLangSelect.value); htmlMonaco.setValue(state.hC || ''); setEditorLanguage(cssMonaco, cssLangSelect.value); cssMonaco.setValue(state.cC || ''); setEditorLanguage(scriptMonaco, scriptLangSelect.value, true); scriptMonaco.setValue(state.sC || ''); appendCmdOutput("Shared code loaded!", "success"); await updatePreview(); } catch (e) { appendCmdOutput(`Error applying state: ${e}`, "error"); console.error("Error applying state:", e); } finally { loadingIndicator.style.display = 'none'; } }
    async function loadSharedCodeFromURL() { const urlParams = new URLSearchParams(window.location.search); const gistId = urlParams.get('gist'); let loaded = false; if (gistId) { appendCmdOutput(`Loading Gist: ${gistId}`, "info"); loadingIndicator.style.display = 'flex'; loadingDetails.textContent = "Fetching Gist..."; try { const response = await fetch(`${GITHUB_API_URL}/${gistId}`); if (!response.ok) throw new Error(`Fetch Gist error: ${response.status}`); const gistData = await response.json(); const fileKey = Object.keys(gistData.files).find(key => key.includes('polyglot-studio-data.json')); if (fileKey && gistData.files[fileKey]?.content) { const state = JSON.parse(gistData.files[fileKey].content); await loadState(state); history.replaceState(null, '', window.location.pathname + window.location.hash); loaded = true; } else throw new Error("Gist content not found."); } catch (error) { appendCmdOutput(`Gist load error: ${error.message}`, "error"); console.error("Gist load error:", error); showToast("Failed to load from Gist.", 4000); } finally { loadingIndicator.style.display = 'none'; } } else if (window.location.hash && window.location.hash.length > 1) { appendCmdOutput("Loading from URL hash...", "info"); const compressedState = window.location.hash.substring(1); try { const jsonState = LZString.decompressFromEncodedURIComponent(compressedState); if (!jsonState) throw new Error("Decompression failed."); const state = JSON.parse(jsonState); await loadState(state); history.replaceState(null, '', window.location.pathname + window.location.search); loaded = true; } catch (error) { appendCmdOutput(`Hash load error: ${error.message}`, "error"); console.error("Hash load error:", error); showToast("Failed to load from link.", 4000); } } return loaded; }
    
    // --- Pyodide Initialization ---
    // This is loaded asynchronously via the 'defer' attribute on its script tag.
    let pyodideReadyPromise = (async function() {
        if (typeof loadPyodide === 'undefined') {
            appendCmdOutput("Pyodide script not loaded yet. Waiting...", "warn");
            // Simple poll check
            await new Promise(res => {
                const interval = setInterval(() => {
                    if (typeof loadPyodide !== 'undefined') {
                        clearInterval(interval);
                        res();
                    }
                }, 100);
            });
        }
        pyodide = await loadPyodide();
        appendCmdOutput("Pyodide v" + pyodide.version + " loaded.", "info");
        try {
            await pyodide.loadPackage('micropip');
            appendCmdOutput("Micropip loaded.", "success");
        } catch (e) {
            appendCmdOutput(`Micropip error: ${e.message}`, "error");
        }
        pyodide.runPython(`import sys,js\ndef custom_input_for_pyodide(p=""): return js.window.prompt(p)\n__builtins__.input = custom_input_for_pyodide`);
        return pyodide;
    })().catch(err => {
        appendCmdOutput(`Pyodide FATAL: ${err.message}`, "error");
        pyodide = null;
        return Promise.reject(err);
    });

    // --- Monaco Editor Initialization ---
    require.config({ paths: { 'vs': 'https://unpkg.com/monaco-editor@0.45.0/min/vs' }});
    window.MonacoEnvironment = { getWorkerUrl: () => proxy };
    let proxy = URL.createObjectURL(new Blob([`self.MonacoEnvironment = { baseUrl: 'https://unpkg.com/monaco-editor@0.45.0/min/' }; importScripts('https://unpkg.com/monaco-editor@0.45.0/min/vs/base/worker/workerMain.js');`], { type: 'text/javascript' }));
    
    require(['vs/editor/editor.main'], async function () {
        monaco.languages.typescript.typescriptDefaults.setCompilerOptions({ target: monaco.languages.typescript.ScriptTarget.ESNext, allowNonTsExtensions: true, moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs, module: monaco.languages.typescript.ModuleKind.ESNext, jsx: monaco.languages.typescript.JsxEmit.React, reactNamespace: "React", allowJs: true, });
        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({ target: monaco.languages.typescript.ScriptTarget.ESNext, allowNonTsExtensions: true, jsx: monaco.languages.typescript.JsxEmit.React, reactNamespace: "React", allowJs: true, });

        loadingIndicator.style.display = 'flex'; 
        loadingDetails.textContent = "Loading Editors...";

        const monacoEditorOptions = { theme: 'vs-dark', lineNumbers: 'on', automaticLayout: true, fontSize: 13, fontFamily: "'Roboto Mono', monospace", wordWrap: 'on', minimap: { enabled: false }, scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9, }, glyphMargin: true, tabSize: 2, insertSpaces: true };
        htmlLangSelect = document.getElementById('html-language-select');
        cssLangSelect = document.getElementById('css-language-select');
        scriptLangSelect = document.getElementById('script-language-select');
        
        // Initialize Monaco Editors (using same revised function)
        htmlMonaco = initializeMonacoEditor('html-editor-container', { ...monacoEditorOptions, language: 'html' }, codePresets.html, false);
        cssMonaco = initializeMonacoEditor('css-editor-container', { ...monacoEditorOptions, language: 'css' }, codePresets.css, false);
        scriptMonaco = initializeMonacoEditor('script-editor-container', { ...monacoEditorOptions, language: 'javascript' }, null, true);

        setEditorLanguage(htmlMonaco, htmlLangSelect.value); 
        setEditorLanguage(cssMonaco, cssLangSelect.value); 
        setEditorLanguage(scriptMonaco, scriptLangSelect.value, true);
        
        htmlLangSelect.addEventListener('change', (e) => { setEditorLanguage(htmlMonaco, e.target.value); debouncedUpdatePreview(); });
        cssLangSelect.addEventListener('change', (e) => { setEditorLanguage(cssMonaco, e.target.value); debouncedUpdatePreview(); });
        scriptLangSelect.addEventListener('change', (e) => { setEditorLanguage(scriptMonaco, e.target.value, true); debouncedUpdatePreview(); });

        const codeWasLoaded = await loadSharedCodeFromURL();
        if (!codeWasLoaded) {
            htmlMonaco.setValue(defaultCodes[htmlLangSelect.value] || ''); 
            cssMonaco.setValue(defaultCodes[cssLangSelect.value] || ''); 
            scriptMonaco.setValue(defaultCodes[scriptLangSelect.value] || '');
            debouncedUpdatePreview();
        }
        loadingIndicator.style.display = 'none';

        // Event Listeners for buttons and modals (unchanged)
        if (manageSnippetsButton) manageSnippetsButton.addEventListener('click', openSnippetModal);
        if (closeSnippetModalButton) closeSnippetModalButton.addEventListener('click', closeSnippetModal);
        if (createNewSnippetButton) createNewSnippetButton.addEventListener('click', () => showSnippetForm(null));
        if (cancelSnippetEditButton) cancelSnippetEditButton.addEventListener('click', () => { snippetEditorFormContainer.style.display = 'none'; snippetForm.reset(); snippetIdInput.value = ''; });
        if (snippetForm) snippetForm.addEventListener('submit', (e) => { e.preventDefault(); const snippetData = { id: snippetIdInput.value || null, language: snippetLanguageInput.value, trigger: snippetTriggerInput.value, template: snippetTemplateInput.value }; let success = snippetData.id ? SnippetManager.updateSnippet(snippetData.id, snippetData) : SnippetManager.addSnippet(snippetData); if (success) { renderUserSnippetsList(); snippetEditorFormContainer.style.display = 'none'; snippetForm.reset(); } });
        if (exportSnippetsButton) exportSnippetsButton.addEventListener('click', () => SnippetManager.exportSnippets());
        if (importSnippetsInput) importSnippetsInput.addEventListener('change', (event) => { const file = event.target.files[0]; if (file) SnippetManager.importSnippets(file); event.target.value = null; });
        window.addEventListener('click', (event) => { if (event.target === snippetModal) closeSnippetModal(); });
        if (shareButton) shareButton.addEventListener('click', handleShareButtonClick); else console.error("Share button element not found!");
    });
    
    // initializeMonacoEditor (unchanged revised logic)
    function initializeMonacoEditor(containerId, baseOptions, staticPresetsGetter, isScriptEditor) {
            const container = document.getElementById(containerId);
            if (!container) { console.error(`Container ${containerId} not found!`); return null; }
            const editor = monaco.editor.create(container, baseOptions);

            editor.onDidChangeModelContent(e => {
                if (e.isFlush || e.isUndoing || e.isRedoing || e.changes.length !== 1) {
                    debouncedUpdatePreview(); 
                    return;
                }

                const change = e.changes[0];
                if (change.text.length === 1 && change.rangeLength === 0) { // Single char typed
                    const model = editor.getModel();
                    const currentPosition = { lineNumber: change.range.startLineNumber, column: change.range.startColumn + 1 };
                    let langForPresets = baseOptions.language;
                    if (isScriptEditor && scriptLangSelect) langForPresets = scriptLangSelect.value;
                    else if (containerId === 'html-editor-container' && htmlLangSelect) langForPresets = htmlLangSelect.value;
                    else if (containerId === 'css-editor-container' && cssLangSelect) langForPresets = cssLangSelect.value;

                    let builtInLangPresets = {};
                    if (staticPresetsGetter && !isScriptEditor) { builtInLangPresets = staticPresetsGetter; }
                    else if (isScriptEditor || !staticPresetsGetter) { builtInLangPresets = codePresets[langForPresets] || {}; if (langForPresets === 'jsx' && Object.keys(builtInLangPresets).length === 0) builtInLangPresets = codePresets['typescript'] || {}; }
                    
                    const userLangSnippets = SnippetManager.getSnippetsByLanguage(langForPresets);
                    let activePresets = { ...builtInLangPresets };
                    userLangSnippets.forEach(s => { activePresets[s.trigger] = s.template; });

                    if (Object.keys(activePresets).length === 0) { debouncedUpdatePreview(); return; }

                    const typedChar = change.text;
                    const lineContentUpToTypedChar = model.getLineContent(currentPosition.lineNumber).substring(0, currentPosition.column);
                    
                    let snippetKeyToUse = null, keywordLength = 0, replaceStartColumn;

                    if (activePresets[typedChar] && lineContentUpToTypedChar === typedChar) {
                        snippetKeyToUse = typedChar; keywordLength = 1; replaceStartColumn = currentPosition.column - keywordLength;
                    }
                    else if (typedChar === ' ') {
                        const textBeforeSpace = lineContentUpToTypedChar.substring(0, lineContentUpToTypedChar.length - 1);
                        const lastWordMatch = textBeforeSpace.match(/(\S+)$/); 
                        if (lastWordMatch) { const potentialKeyword = lastWordMatch[1]; if (activePresets[potentialKeyword]) { snippetKeyToUse = potentialKeyword; keywordLength = potentialKeyword.length + 1; replaceStartColumn = currentPosition.column - keywordLength; } }
                    }

                    if (snippetKeyToUse && activePresets[snippetKeyToUse]) {
                        const snippetTemplate = activePresets[snippetKeyToUse];
                        const preciseRangeToReplace = new monaco.Range(currentPosition.lineNumber, replaceStartColumn + 1, currentPosition.lineNumber, currentPosition.column);
                        let snippetToInsert = snippetTemplate;
                        let finalCursorPosRel = null;
                        const cursorPosMarker = "$CURSOR$";
                        if (snippetTemplate.includes(cursorPosMarker)) {
                            const markerIndex = snippetTemplate.indexOf(cursorPosMarker);
                            snippetToInsert = snippetTemplate.replace(cursorPosMarker, "");
                            const linesUpToMarker = snippetTemplate.substring(0, markerIndex).split('\n');
                            finalCursorPosRel = { lineOffset: linesUpToMarker.length - 1, chOffset: linesUpToMarker[linesUpToMarker.length - 1].length };
                        }
                        const op = { range: preciseRangeToReplace, text: snippetToInsert, forceMoveMarkers: true };
                        editor.executeEdits("snippet-expansion", [op]);

                        if (finalCursorPosRel) {
                            const finalLineNumber = preciseRangeToReplace.startLineNumber + finalCursorPosRel.lineOffset;
                            const finalColumn0Based = (finalCursorPosRel.lineOffset === 0 ? (preciseRangeToReplace.startColumn -1) : 0) + finalCursorPosRel.chOffset;
                            editor.setPosition({ lineNumber: finalLineNumber, column: finalColumn0Based + 1 });
                            editor.revealPositionInCenterIfOutsideViewport({ lineNumber: finalLineNumber, column: finalColumn0Based + 1 });
                        } else {
                            const insertedLines = snippetToInsert.split('\n');
                            let endLine, endColumn0Based;
                            if (insertedLines.length === 1) { endLine = preciseRangeToReplace.startLineNumber; endColumn0Based = (preciseRangeToReplace.startColumn - 1) + insertedLines[0].length; } 
                            else { endLine = preciseRangeToReplace.startLineNumber + insertedLines.length - 1; endColumn0Based = insertedLines[insertedLines.length - 1].length; }
                            editor.setPosition({ lineNumber: endLine, column: endColumn0Based + 1});
                            editor.revealPositionInCenterIfOutsideViewport({ lineNumber: endLine, column: endColumn0Based + 1});
                        }
                        debouncedUpdatePreview();
                        return; 
                    }
                }
                debouncedUpdatePreview();
            });
            return editor;
    }

    function setEditorLanguage(editorInstance, langKey, isScriptEditor = false) { if (!editorInstance) return; const monacoLang = getMonacoLangId(langKey); monaco.editor.setModelLanguage(editorInstance.getModel(), monacoLang); }

    // --- Transpilation, Preview, and Execution ---
    // IMPROVEMENT: These functions now use the TranspilerManager to load dependencies on demand.
    async function transpileHtml(rawHtml, lang) {
        if (lang === 'markdown') {
            try {
                const marked = await TranspilerManager.get('marked');
                return marked.parse(rawHtml);
            } catch (e) {
                appendCmdOutput(`MD Error: ${e.message}`, 'error');
                return `<pre style="color:red">Markdown Error: ${e.message}</pre>${rawHtml}`;
            }
        }
        return rawHtml;
    }

    async function transpileCss(rawCss, lang) {
        if (lang === 'scss') {
            try {
                const sassInstance = await TranspilerManager.get('sass');
                return new Promise(resolve => {
                    sassInstance.compile(rawCss, result => {
                        if (result.status === 0) {
                            resolve(result.text);
                        } else {
                            const eM = result.formatted || result.message || "SCSS err";
                            appendCmdOutput(`SCSS Error: ${eM}`, 'error');
                            resolve(`/* SCSS Error: ${eM.replace(/\n/g, ' ').replace(/"/g, '\\"')} */\n${rawCss}`);
                        }
                    });
                });
            } catch (e) {
                appendCmdOutput(`SCSS Error: ${e.message}`, 'error');
                return `/* SCSS Load Error: ${e.message} */\n${rawCss}`;
            }
        }
        return rawCss;
    }

    async function transpileScript(rawScript, lang) {
        if (lang === 'typescript') {
            try {
                const ts = await TranspilerManager.get('typescript');
                return ts.transpileModule(rawScript, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.React } }).outputText;
            } catch (e) {
                appendCmdOutput(`TS Error: ${e.message}`, 'error');
                return `console.error("TS Error: ${e.message.replace(/"/g, '\\"').replace(/\n/g, '\\n')}");`;
            }
        } else if (lang === 'jsx') {
            try {
                const Babel = await TranspilerManager.get('babel');
                return Babel.transform(rawScript, { presets: ["react"], filename: "script.jsx" }).code;
            } catch (e) {
                appendCmdOutput(`JSX Error: ${e.message}`, 'error');
                return `console.error("JSX Error: ${e.message.replace(/"/g, '\\"').replace(/\n/g, '\\n')}");`;
            }
        }
        return rawScript;
    }
    
    // updatePreview and runPythonCode are largely unchanged but benefit from the async transpilers
    const updatePreview = async () => { if (!htmlMonaco || !cssMonaco || !scriptMonaco) return; const rH = htmlMonaco.getValue(), rCss = cssMonaco.getValue(), rS = scriptMonaco.getValue(); const hL = htmlLangSelect.value, csL = cssLangSelect.value, sL = scriptLangSelect.value; consoleOutputPyElement.textContent=''; if(sL==='python'){ iframeContainer.style.display='none';outputConsoleContainer.style.display='flex'; if(pyodide){ consoleOutputPyElement.textContent="🐍 Running Py...\n"; try{ await runPythonCode(rS); consoleOutputPyElement.textContent+="\n✅ Py done.";} catch(e){ consoleOutputPyElement.textContent+=`\n❌ Py Err: ${e.name} - ${e.message}`;} } else { consoleOutputPyElement.textContent="Pyodide not ready.";} return; } iframeContainer.style.display='flex'; outputConsoleContainer.style.display='none'; let pH = await transpileHtml(rH,hL); let pCss = await transpileCss(rCss,csL); let pJS = await transpileScript(rS,sL); const scriptContentForPreview = `(async()=>{try{${pJS}}catch(e){console.error('Preview Error:',e);document.body.insertAdjacentHTML('afterbegin','<div style="color:red;background:pink;padding:5px;border:1px solid red;">JS Error: '+e.message+'</div>')}})()`; const outputDoc = previewFrame.contentDocument || previewFrame.contentWindow.document; try { outputDoc.open(); outputDoc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${pCss}</style></head><body>${pH}<script type="module">${scriptContentForPreview}<\/script></body></html>`); outputDoc.close(); } catch (e) { console.error("Preview write error:", e); appendCmdOutput("Preview update failed.", "error");} };
    const debouncedUpdatePreview = debounce(updatePreview, 300);
    async function runPythonCode(code){if(!pyodide)throw new Error("Pyodide not init.");pyodide.setStdout({batched:(msg)=>consoleOutputPyElement.textContent+=msg+"\n"});pyodide.setStderr({batched:(msg)=>consoleOutputPyElement.textContent+="Error: "+msg+"\n"});try{await pyodide.runPythonAsync(code);}finally{pyodide.setStdout({});pyodide.setStderr({});}}

    // --- Command Prompt, Download, Clear (unchanged logic) ---
    cmdToggleButton.addEventListener('click', () => { const isVisible = cmdPanel.style.display === 'flex'; cmdPanel.style.display = isVisible ? 'none' : 'flex'; if (!isVisible) cmdInput.focus();});
    cmdInput.addEventListener('keydown', async (e) => { if (e.key === 'Enter') { const commandLine = cmdInput.value.trim(); cmdInput.value = ''; if(commandLine==='')return; appendCmdOutput(`PS > ${commandLine}`); const [command, ...args] = commandLine.split(/\s+/); switch (command.toLowerCase()) { case 'help': appendCmdOutput("Commands: help, clear, echo, download, show_code, run_python, py_install, js_fetch_imports",'info'); appendCmdOutput("py_install <pkg> OR py_install -r <filename_for_prompt>", "info"); break; case 'clear': case 'cls': cmdOutput.innerHTML = '<div class="cmd-line cmd-info">Polyglot Studio CMD - Type \'help\'</div><div class="cmd-line"></div>'; break; case 'echo': appendCmdOutput(args.join(' ')); break; case 'download': await handleDownloadCommand(args[0]); break; case 'show_code': const ek=args[0]?.toLowerCase();if(ek==='html' && htmlMonaco)appendCmdOutput(htmlMonaco.getValue());else if(ek==='css' && cssMonaco)appendCmdOutput(cssMonaco.getValue());else if(ek==='script' && scriptMonaco)appendCmdOutput(scriptMonaco.getValue());else appendCmdOutput("Usage: show_code <html|css|script>",'error');break; case 'run_python': if(scriptLangSelect.value==='python' && scriptMonaco){appendCmdOutput("Exec Py...",'info');try{await runPythonCode(scriptMonaco.getValue());appendCmdOutput("Py exec done.",'success');}catch(err){appendCmdOutput(`Py CMD Err: ${err.message}`,'error');}}else{appendCmdOutput("Py not selected.",'error');}break; case 'py_install': if(pyodide&&args.length>0){let pkgsToInstall=[];let cmdFail=false;if(args[0].toLowerCase()==='-r'&&args.length>1){const reqFile=args[1];appendCmdOutput(`Simulating install from '${reqFile}'...`,'info');const reqContent=prompt(`Paste content of '${reqFile}':`);if(reqContent===null){appendCmdOutput("Install from reqs cancelled.",'warn');cmdFail=true;}else if(reqContent.trim()===""){appendCmdOutput("Reqs empty.",'warn');cmdFail=true;}else{pkgsToInstall=reqContent.split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'));if(pkgsToInstall.length===0){appendCmdOutput(`No valid pkgs in content for '${reqFile}'.`,'warn');cmdFail=true;}}}else if(args[0].toLowerCase()==='-r'){appendCmdOutput("Usage: py_install -r <filename>",'error');cmdFail=true;}else{pkgsToInstall=[args[0].trim()];if(!pkgsToInstall[0]){appendCmdOutput("Pkg name empty.",'error');cmdFail=true;}}if(!cmdFail&&pkgsToInstall.length>0){appendCmdOutput(`Installing: ${pkgsToInstall.join(', ')}...`,'info');loadingIndicator.style.display='flex';loadingDetails.textContent=`Installing ${pkgsToInstall.length} pkg(s)...`;(async()=>{try{await pyodideReadyPromise; const pkgListStr=JSON.stringify(pkgsToInstall);const pyInstallScript=`import micropip\nimport json\npkgs_json='''${pkgListStr}'''\npkgs=json.loads(pkgs_json)\nprint(f"Micropip: {', '.join(pkgs) if pkgs else 'None'}")\nfor pkg_name in pkgs:\n  if not pkg_name:continue\n  try:\n    print(f"Micropip: Installing {pkg_name}...")\n    await micropip.install(pkg_name)\n    print(f"Micropip: {pkg_name} installed.")\n  except Exception as e:\n    print(f"Micropip Error for {pkg_name}: {e}")\nprint("Micropip: All attempted.")`;await pyodide.runPythonAsync(pyInstallScript);appendCmdOutput(`Pkg install for: ${pkgsToInstall.join(', ')} initiated.`, 'success');}catch(err){appendCmdOutput(`Micropip cmd error: ${err.message}`,'error');}finally{loadingIndicator.style.display='none';}})();}}else if(!pyodide){appendCmdOutput("Pyodide not ready.",'error');}else{appendCmdOutput("Usage: py_install <pkg> OR py_install -r <filename>",'error');}break; case 'js_fetch_imports': handleJsFetchImports(); break; default: appendCmdOutput(`'${command}' not recognized. Type 'help'.`,'error'); if(['npm','pip','node'].includes(command.toLowerCase())){appendCmdOutput(`Note: System commands like '${command}' not supported.`, 'warn');appendCmdOutput(`Try 'py_install <pkg>' or 'js_fetch_imports'.`,'warn');} } if(cmdOutput.textContent.length > 7000) cmdOutput.textContent = cmdOutput.textContent.slice(-7000); appendCmdOutput(""); }});
    function handleJsFetchImports(){ const sL=scriptLangSelect.value;if(!['javascript','typescript','jsx'].includes(sL)){appendCmdOutput("`js_fetch_imports` for JS/TS/JSX.",'error');return;}if(!scriptMonaco){appendCmdOutput("Script editor not ready.", "error"); return;} const code=scriptMonaco.getValue();const importRegex=/import\s+.*?from\s+['"]([^'"]+)['"]/g;let match;const imports=new Set();while((match=importRegex.exec(code))!==null){imports.add(match[1]);}if(imports.size===0){appendCmdOutput("No imports found.",'info');return;}appendCmdOutput("Potential imports (experimental):",'info');imports.forEach(pkg=>{if(pkg.startsWith('.')||pkg.startsWith('/')){appendCmdOutput(`  - Local: ${pkg}`,'warn');}else{appendCmdOutput(`  ${pkg}:`);appendCmdOutput(`    esm.sh: https://esm.sh/${pkg}`);appendCmdOutput(`    unpkg:  https://unpkg.com/${pkg}`);}});appendCmdOutput("Note: These are suggestions.",'warn');}
    async function handleDownloadCommand(type){ if (!htmlMonaco || !cssMonaco || !scriptMonaco) { appendCmdOutput("Editors not ready.", "error"); return; } const dT=type?.toLowerCase();const rH=htmlMonaco.getValue(),rC=cssMonaco.getValue(),rS=scriptMonaco.getValue();const hL=htmlLangSelect.value,cL=cssLangSelect.value,sL=scriptLangSelect.value;appendCmdOutput(`Download: ${dT||'smart_default'}...`,'info');if(dT==='html_src'){triggerDownload(new Blob([rH],{type:'text/plain'}),hL==='markdown'?'source.md':'source.html');appendCmdOutput("DL HTML src.",'success');}else if(dT==='css_src'){triggerDownload(new Blob([rC],{type:'text/plain'}),cL==='scss'?'source.scss':'source.css');appendCmdOutput("DL CSS src.",'success');}else if(dT==='script_src'){let ext='.js';if(sL==='typescript')ext='.ts';else if(sL==='jsx')ext='.jsx';else if(sL==='python')ext='.py';triggerDownload(new Blob([rS],{type:'text/plain'}),`script${ext}`);appendCmdOutput("DL Script src.",'success');}else if(dT==='single_html'){if(hL==='html'&&cL==='css'&&['javascript','typescript','jsx'].includes(sL)){let fH=rH,fC=await transpileCss(rC,cL),fJ=await transpileScript(rS,sL);let doc=codePresets.html['!'].replace("$CURSOR$","");const bodyContentMatch=fH.match(/<body[^>]*>([\s\S]*?)<\/body>/i); if(bodyContentMatch&&bodyContentMatch[1]){doc=doc.replace(/<body>([\s\S]*?)<\/body>/i,`<body ${fH.match(/<body([^>]*)>/i)?.[1]||''}>${bodyContentMatch[1]}</body>`);}else{doc=doc.replace(/<body>([\s\S]*?)<\/body>/i,`<body>${fH}</body>`);}doc=doc.replace('</head>',`<style>\n${fC}\n</style>\n</head>`);doc=doc.replace('</body>',`<script type="module">(async()=>{${fJ}})()<\/script></body>`);triggerDownload(new Blob([doc],{type:'text/html'}),'index_combined.html');appendCmdOutput("DL combined HTML.",'success');}else{appendCmdOutput("single_html for HTML/CSS/JS(TS/JSX).",'error');}}else if(dT==='project_zip'){if(typeof JSZip==='undefined'){appendCmdOutput("JSZip not loaded.",'error');return;}const zip=new JSZip();let sF="script.js";if(sL==='typescript')sF="script.ts";else if(sL==='jsx')sF="script.jsx";else if(sL==='python')sF="script.py";zip.file(hL==='markdown'?"source.md":"index.html",rH);zip.file(cL==='scss'?"style.scss":"style.css",rC);zip.file(sF,rS);let runH=await transpileHtml(rH,hL),runC=await transpileCss(rC,cL);const idxHTML=`<!DOCTYPE html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="${cL==='scss'?'style.css':'style.css'}"><title>Project</title></head><body>${runH}<script src="${sF}" ${sL !== 'python' ? 'type="module" defer' : 'defer'}><\/script></body></html>`;zip.file("index.html",idxHTML); if(cL==='scss') zip.file("style.css", runC); zip.generateAsync({type:"blob"}).then(b=>triggerDownload(b,"project.zip"));appendCmdOutput("Generated project.zip.",'success');}else{appendCmdOutput(`Unknown download type: '${type}'.`,'error');}}
    document.getElementById('clear-button').addEventListener('click',()=>{ if (!htmlMonaco || !cssMonaco || !scriptMonaco) return; if(confirm("Clear all editors?")){ htmlMonaco.setValue(defaultCodes[htmlLangSelect.value] || ''); cssMonaco.setValue(defaultCodes[cssLangSelect.value] || ''); scriptMonaco.setValue(defaultCodes[scriptLangSelect.value] || ''); }});
    document.getElementById('download-button').addEventListener('click',async()=>{ if (!htmlMonaco || !cssMonaco || !scriptMonaco) { appendCmdOutput("Editors not ready.", "error"); return; } const hL=htmlLangSelect.value,cL=cssLangSelect.value,sL=scriptLangSelect.value; if(sL==='python'){await handleDownloadCommand('script_src');} else if(hL==='html'&&cL==='css'&&['javascript','typescript','jsx'].includes(sL)){await handleDownloadCommand('single_html');} else{await handleDownloadCommand('project_zip');}});

    // --- IMPROVEMENT: Logic for the resizable splitter ---
    function initializeResizer() {
        const resizer = document.getElementById('resizer');
        const leftSide = document.querySelector('.editors-container');
        const rightSide = document.querySelector('.preview-and-console-wrapper');
        
        let x = 0;
        let leftWidth = 0;

        const mouseDownHandler = function (e) {
            x = e.clientX;
            leftWidth = leftSide.getBoundingClientRect().width;

            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
            
            // Style changes for better UX during resize
            resizer.style.backgroundColor = 'var(--accent-purple)';
            document.body.style.cursor = 'col-resize';
            leftSide.style.userSelect = 'none';
            rightSide.style.userSelect = 'none';
        };

        const mouseMoveHandler = function (e) {
            const dx = e.clientX - x;
            const newLeftWidth = ((leftWidth + dx) * 100) / resizer.parentNode.getBoundingClientRect().width;
            
            // Constrain the width
            if (newLeftWidth > 15 && newLeftWidth < 85) {
                leftSide.style.width = `${newLeftWidth}%`;
                rightSide.style.width = `calc(100% - ${newLeftWidth}% - 8px)`;
            }
        };

        const mouseUpHandler = function () {
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);

            // Reset styles
            resizer.style.backgroundColor = '';
            document.body.style.cursor = 'default';
            leftSide.style.userSelect = '';
            rightSide.style.userSelect = '';
        };

        resizer.addEventListener('mousedown', mouseDownHandler);
    }
    
    initializeResizer();

})(); // End of IIFE wrapper
