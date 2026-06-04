import type React from 'react';
import { useState } from 'react';
import { api } from '../lib/api';
import { queryClient } from '../queryClient';
import { Card, Field } from './ui';

export function AuthPanel() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password }) });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setMessage(mode === 'login' ? 'Logged in' : 'Account created');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Authentication failed');
    }
  }

  return (
    <Card title="Account" marker="[x]">
      <form onSubmit={submit} className="stack compact-form">
        <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" /></Field>
        <Field label="Password"><input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></Field>
        <div className="row">
          <button type="submit">{mode === 'login' ? 'Login' : 'Register'}</button>
          <button type="button" className="secondary" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Register' : 'Login'}</button>
        </div>
      </form>
      {message && <p className="note">[i] {message}</p>}
    </Card>
  );
}
