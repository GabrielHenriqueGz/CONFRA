// Servidor simples, sem dependências. Rode com: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const INDEX_FILE = path.join(__dirname, 'index.html');

// Se JSONBIN_BIN_ID e JSONBIN_KEY estiverem definidos, os dados ficam no JSONBin.
// Caso contrário, usa o data.json local (útil para rodar no próprio computador).
const BIN_ID = process.env.JSONBIN_BIN_ID;
const BIN_KEY = process.env.JSONBIN_KEY;
const USA_JSONBIN = Boolean(BIN_ID && BIN_KEY);
const BIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;
const VAZIO = () => ({ participantes: [], gastos: [] });

// Cache em memória: lê do armazenamento uma vez e só grava quando algo muda.
// Economiza requisições do plano grátis do JSONBin.
let cache = null;

async function readData() {
  if (cache) return cache;
  if (USA_JSONBIN) {
    const res = await fetch(`${BIN_URL}/latest`, {
      headers: { 'X-Master-Key': BIN_KEY, 'X-Bin-Meta': 'false' },
    });
    if (!res.ok) throw new Error(`Erro ao ler JSONBin (${res.status}): ${await res.text()}`);
    const data = await res.json();
    cache = { participantes: data.participantes || [], gastos: data.gastos || [] };
  } else {
    try {
      cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
      cache = VAZIO();
    }
  }
  return cache;
}

async function writeData(data) {
  if (USA_JSONBIN) {
    const res = await fetch(BIN_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': BIN_KEY },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      cache = null; // força recarregar do JSONBin na próxima leitura
      throw new Error(`Erro ao salvar no JSONBin (${res.status}): ${await res.text()}`);
    }
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  }
  cache = data;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type + '; charset=utf-8' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
  });
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean); // ex: ['api','participantes','id']

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, fs.readFileSync(INDEX_FILE, 'utf8'), 'text/html');
    }

    if (parts[0] !== 'api') return send(res, 404, { erro: 'Não encontrado' });

    const data = await readData();
    const [, recurso, id] = parts;

    if (req.method === 'GET' && !recurso) return send(res, 200, data);

    // ---------- Participantes ----------
    if (recurso === 'participantes') {
      if (req.method === 'POST') {
        const { nome } = await readBody(req);
        if (!nome || !nome.trim()) return send(res, 400, { erro: 'Nome obrigatório' });
        const p = { id: newId(), nome: nome.trim() };
        data.participantes.push(p);
        writeData(data);
        return send(res, 201, p);
      }
      const p = data.participantes.find((x) => x.id === id);
      if (!p) return send(res, 404, { erro: 'Participante não encontrado' });
      if (req.method === 'PUT') {
        const { nome } = await readBody(req);
        if (!nome || !nome.trim()) return send(res, 400, { erro: 'Nome obrigatório' });
        p.nome = nome.trim();
        writeData(data);
        return send(res, 200, p);
      }
      if (req.method === 'DELETE') {
        data.participantes = data.participantes.filter((x) => x.id !== id);
        data.gastos = data.gastos.filter((g) => g.participanteId !== id); // remove gastos dele
        writeData(data);
        return send(res, 204, '');
      }
    }

    // ---------- Gastos ----------
    if (recurso === 'gastos') {
      const validar = (b) => {
        const valor = Number(b.valor);
        if (!b.descricao || !b.descricao.trim()) return 'Descrição obrigatória';
        if (!Number.isFinite(valor) || valor <= 0) return 'Valor deve ser maior que zero';
        if (!data.participantes.some((p) => p.id === b.participanteId)) return 'Participante inválido';
        return null;
      };
      if (req.method === 'POST') {
        const b = await readBody(req);
        const erro = validar(b);
        if (erro) return send(res, 400, { erro });
        const g = { id: newId(), participanteId: b.participanteId, descricao: b.descricao.trim(), valor: Number(b.valor) };
        data.gastos.push(g);
        writeData(data);
        return send(res, 201, g);
      }
      const g = data.gastos.find((x) => x.id === id);
      if (!g) return send(res, 404, { erro: 'Gasto não encontrado' });
      if (req.method === 'PUT') {
        const b = await readBody(req);
        const erro = validar(b);
        if (erro) return send(res, 400, { erro });
        Object.assign(g, { participanteId: b.participanteId, descricao: b.descricao.trim(), valor: Number(b.valor) });
        writeData(data);
        return send(res, 200, g);
      }
      if (req.method === 'DELETE') {
        data.gastos = data.gastos.filter((x) => x.id !== id);
        writeData(data);
        return send(res, 204, '');
      }
    }

    send(res, 404, { erro: 'Rota não encontrada' });
  } catch (e) {
    send(res, 500, { erro: e.message });
  }
}).listen(PORT, () => {
  console.log(`CONFRA CRISTAIS STRIKE rodando em http://localhost:${PORT}`);
  console.log(USA_JSONBIN ? 'Armazenamento: JSONBin' : 'Armazenamento: data.json local');
});
