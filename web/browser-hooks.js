(() => {
  let lifecycle;
  let lastAction;
  let unsaved = false;
  window.addEventListener('beforeunload', event => {
    if (!unsaved) return;
    event.preventDefault();
    event.returnValue = '';
  });
  const object = properties => ({type: 'object', properties, additionalProperties: false});
  window.rhythmBrowser = {
    hasUnsaved() { return unsaved; },
    logout() { return window.rhythmAuth.logout(); },
    pickBackup() {
      if (!window.rhythmAuth.active) return Promise.resolve(JSON.stringify({error:true}));
      return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        const finish = value => { input.remove(); resolve(JSON.stringify(value)); };
        input.oncancel = () => finish({cancelled:true});
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) { finish({cancelled:true}); return; }
          try {
            if (file.size > 20 * 1024 * 1024) throw new Error('Backup exceeds 20 MB.');
            const json = new TextDecoder('utf-8', {fatal:true}).decode(await file.arrayBuffer());
            if (!window.rhythmAuth.active) throw new Error('AUTHENTICATION_REQUIRED');
            finish({json});
          } catch (_) { finish({error:true}); }
        };
        document.body.appendChild(input);
        input.click();
      });
    },
    download(fileName, json) {
      if (!window.rhythmAuth.active) throw new Error('AUTHENTICATION_REQUIRED');
      const url = URL.createObjectURL(new Blob([json], {type:'application/json;charset=utf-8'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    setUnsaved(value) { unsaved = value; },
    suspend() { lifecycle?.abort(); lifecycle = undefined; },
    resume() { if (!lifecycle && lastAction) window.rhythmBrowser.attach(lastAction); },
    detach() { lifecycle?.abort(); lifecycle = undefined; unsaved = false; lastAction = undefined; },
    attach(action) {
      lastAction = action;
      lifecycle?.abort();
      lifecycle = new AbortController();
      const signal = lifecycle.signal;
      const context = document.modelContext;
      if (!context?.registerTool) return;
      const definitions = [
        ['read_journal', 'Read the current habit journal and save status.', object({}), true],
        ['open_journal_day', 'Select a civil calendar day and open its journal.', {...object({day: {type:'string', pattern:'^\\d{4}-\\d{2}-\\d{2}$'}}), required:['day']}, false],
        ['start_habit_creation', 'Open the habit creation form. The user still needs to save it.', object({}), false],
        ['record_habit_entries', 'Save daily entries for existing habits. For categorized durations supply both ordered sessions (topic, minutes) and the total minutes including unassigned time. Repeated topics remain separate sessions. Returns only after saving finishes. Future days are rejected.', {
          ...object({entries:{type:'array', minItems:1, maxItems:100, items:{
            ...object({habitID:{type:'string'}, day:{type:'string'}, checked:{type:'boolean'}, selections:{type:'array',items:{type:'string'}}, minutes:{type:'integer',minimum:0,maximum:9007199254740991}, number:{type:['number','null'],minimum:0}, text:{type:'string'}, sessions:{type:'array',items:{...object({topic:{type:'string'},minutes:{type:'integer',minimum:0,maximum:9007199254740991}}),required:['topic','minutes']}}}),
            required:['habitID','day'],
          }}}), required:['entries'],
        }, false],
      ];
      for (const [name, description, inputSchema, readOnlyHint] of definitions) {
        try {
          Promise.resolve(context.registerTool({name, description, inputSchema,
            annotations:{readOnlyHint,untrustedContentHint:true},
            async execute(input) {
              if (signal.aborted) throw new Error('AUTHENTICATION_REQUIRED');
              await window.rhythmAuth.check();
              if (signal.aborted) throw new Error('AUTHENTICATION_REQUIRED');
              const result = await action(name, JSON.stringify(input));
              await window.rhythmAuth.check();
              if (signal.aborted) throw new Error('AUTHENTICATION_REQUIRED');
              return JSON.parse(result);
            }
          }, {signal})).catch(() => {});
        } catch (_) { /* Standard browsers continue without optional agent tools. */ }
      }
    },
  };
})();
