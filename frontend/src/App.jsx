import React, { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function AuthForm({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!EMAIL_RE.test(email)) return setError('Введите корректный email');
    if (password.length < 8) return setError('Пароль должен быть не короче 8 символов');
    setBusy(true);
    try {
      if (mode === 'register') await api('/api/register', { method: 'POST', body: { email, password } });
      const { token } = await api('/api/login', { method: 'POST', body: { email, password } });
      setToken(token);
      onAuth();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card auth" onSubmit={submit} noValidate>
      <h1>API Gateway</h1>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
      <label>Пароль<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button disabled={busy}>{mode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
      <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
        {mode === 'login' ? 'Нет аккаунта? Регистрация' : 'Уже есть аккаунт? Войти'}
      </button>
    </form>
  );
}

function Keys({ onError }) {
  const [keys, setKeys] = useState([]);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState(null);

  const load = useCallback(() => api('/api/keys').then(setKeys).catch((e) => onError(e)), [onError]);
  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    try {
      const k = await api('/api/keys', { method: 'POST', body: name.trim() ? { name } : {} });
      setFresh(k.key);
      setName('');
      load();
    } catch (err) { onError(err); }
  }
  async function revoke(id) {
    try { await api(`/api/keys/${id}`, { method: 'DELETE' }); load(); } catch (err) { onError(err); }
  }

  return (
    <section className="card">
      <h2>API-ключи</h2>
      <form className="row" onSubmit={create}>
        <input placeholder="Название (необязательно)" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        <button>Создать ключ</button>
      </form>
      {fresh && (
        <p className="notice">Скопируйте ключ — он показывается один раз:<br /><code>{fresh}</code></p>
      )}
      <div className="scroll">
        <table>
          <thead><tr><th>Название</th><th>Ключ</th><th>Статус</th><th /></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td><td><code>{k.prefix}…</code></td>
                <td>{k.is_active ? 'активен' : 'отозван'}</td>
                <td>{k.is_active && <button className="danger" onClick={() => revoke(k.id)}>Отозвать</button>}</td>
              </tr>
            ))}
            {keys.length === 0 && <tr><td colSpan="4">Ключей пока нет</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Bars({ items, label, value, color = 'var(--accent)' }) {
  const max = Math.max(1, ...items.map(value));
  return (
    <ul className="bars">
      {items.map((it, i) => (
        <li key={i}>
          <span className="lbl" title={label(it)}>{label(it)}</span>
          <span className="bar"><i style={{ width: `${(value(it) / max) * 100}%`, background: color }} /></span>
          <b>{value(it)}</b>
        </li>
      ))}
      {items.length === 0 && <li className="muted">Нет данных</li>}
    </ul>
  );
}

function Dashboard({ onError }) {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState(null);

  useEffect(() => {
    api(`/api/analytics?hours=${hours}`).then(setData).catch(onError);
  }, [hours, onError]);

  const s = data?.summary;
  const rate = s && s.total ? ((s.errors / s.total) * 100).toFixed(1) : '0.0';

  return (
    <section className="card">
      <div className="row between">
        <h2>Аналитика</h2>
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={1}>1 час</option><option value={24}>24 часа</option><option value={168}>7 дней</option>
        </select>
      </div>
      {!data ? <p>Загрузка…</p> : (
        <>
          <div className="stats">
            <div><span>Запросов</span><b>{s.total}</b></div>
            <div><span>Ошибок</span><b>{s.errors} ({rate}%)</b></div>
            <div><span>Среднее время</span><b>{s.avgMs} мс</b></div>
          </div>
          <h3>Нагрузка по часам</h3>
          <Bars items={data.timeline} label={(t) => new Date(t.bucket).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} value={(t) => t.requests} />
          <h3>Топ эндпоинтов</h3>
          <Bars items={data.topEndpoints} label={(e) => e.endpoint} value={(e) => e.requests} />
          <h3>Коды ответов</h3>
          <Bars items={data.statusCodes} label={(c) => String(c.status)} value={(c) => c.count} color="var(--warn)" />
        </>
      )}
    </section>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [error, setError] = useState('');

  const logout = useCallback(() => { setToken(null); setAuthed(false); }, []);
  const onError = useCallback((e) => {
    if (e.status === 401) return logout();
    setError(e.message);
  }, [logout]);

  if (!authed) return <AuthForm onAuth={() => setAuthed(true)} />;
  return (
    <main>
      <header className="row between">
        <h1>API Gateway</h1>
        <button className="link" onClick={logout}>Выйти</button>
      </header>
      {error && <p className="error" role="alert" onClick={() => setError('')}>{error}</p>}
      <Keys onError={onError} />
      <Dashboard onError={onError} />
    </main>
  );
}
