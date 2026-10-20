(() => {
  const $ = id => document.getElementById(id);
  let language = 'en', setup = false;
  try { language = localStorage.getItem('rhythm.language') === 'zh' ? 'zh' : 'en'; } catch {}
  const copy = {
    en:{private:'PRIVATE JOURNAL',welcome:'Welcome back.',create:'Make it yours.',intro:'Sign in to open your daily journal.',setup:'Create your admin login. This one-time setup is available only through your private site access.',username:'Admin username',password:'Password',confirm:'Confirm password',hint:'Use a unique passphrase of 15–128 characters. Username: 3–64 letters, digits, dots, dashes or underscores.',remember:'Remember me for 30 days',login:'Sign in',createButton:'Create admin account',note:'Your habits are saved to your account. Sign in from another browser to open the same journal.',footer:"One day at a time. A space that's yours.",busy:'Please wait…',mismatch:'The passwords do not match.',INVALID_LOGIN:'Incorrect username or password.',INVALID_CREDENTIALS:'Check the username format and use a password of 15–128 characters.',TOO_MANY_ATTEMPTS:'Too many attempts. Try again in 15 minutes.',SETUP_CLOSED:'An admin already exists. Reload this page to sign in.',unavailable:'Cannot verify access right now. Please reload and try again.'},
    zh:{private:'私人日记',welcome:'欢迎回来。',create:'开启你的专属空间。',intro:'登录以打开你的每日日记。',setup:'创建管理员账号。只有通过私人网站访问验证后，才能进行这一次性设置。',username:'管理员用户名',password:'密码',confirm:'确认密码',hint:'请使用 15–128 个字符的独有密码。用户名为 3–64 个英文字母、数字、点、短横线或下划线。',remember:'记住我 30 天',login:'登录',createButton:'创建管理员账号',note:'习惯数据保存在账号中。在其他浏览器登录即可打开同一份日记。',footer:'一天一步，属于你的空间。',busy:'请稍候…',mismatch:'两次输入的密码不一致。',INVALID_LOGIN:'用户名或密码不正确。',INVALID_CREDENTIALS:'请检查用户名格式，并使用 15–128 个字符的密码。',TOO_MANY_ATTEMPTS:'尝试次数过多，请在 15 分钟后重试。',SETUP_CLOSED:'管理员账号已存在。请刷新页面后登录。',unavailable:'暂时无法验证访问权限。请刷新后重试。'},
  };
  const t = key => copy[language][key] ?? copy[language].unavailable;
  function render() {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    $('language').value = language;
    document.querySelectorAll('[data-text]').forEach(el => { el.textContent = t(el.dataset.text); });
    $('heading').textContent = t(setup ? 'create' : 'welcome');
    $('intro').textContent = t(setup ? 'setup' : 'intro');
    $('submit').textContent = t(setup ? 'createButton' : 'login');
    $('setup-fields').hidden = !setup;
    $('confirm').required = setup;
    $('password').autocomplete = setup ? 'new-password' : 'current-password';
    $('password').minLength = setup ? 15 : 1;
  }
  $('language').onchange = () => { language = $('language').value; try { localStorage.setItem('rhythm.language',language); } catch {} render(); };
  render();
  fetch('/api/auth/session',{cache:'no-store',credentials:'same-origin',redirect:'error'})
    .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
    .then(state => { if (state.authenticated) { location.replace('/'); return; } setup = state.setupRequired === true; render(); $('submit').disabled = false; })
    .catch(() => { $('error').textContent = t('unavailable'); });
  $('form').addEventListener('submit',async event => {
    event.preventDefault(); $('error').textContent = '';
    if (setup && $('password').value !== $('confirm').value) { $('error').textContent = t('mismatch'); return; }
    $('submit').disabled = true; $('submit').textContent = t('busy');
    try {
      const response = await fetch(setup ? '/api/auth/setup' : '/api/auth/login', {
        method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',
        headers:{'Content-Type':'application/json','X-Rhythm-Request':'1'},
        body:JSON.stringify({username:$('username').value,password:$('password').value,remember:$('remember').checked}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      $('password').value = ''; $('confirm').value = ''; location.replace('/');
    } catch(error) { $('error').textContent = t(error.message); $('submit').disabled = false; render(); }
  });
})();
