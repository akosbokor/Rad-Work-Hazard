import express from 'express';
import cors from 'cors';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const PORT = 8080;
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
