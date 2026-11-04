"use client";

// Falha no layout raiz, o único caso que o error.tsx não pega. Esta tela substitui
// o layout inteiro: por isso tem html e body próprios e estilos escritos aqui.
export default function ErroGeral({ retry }: { retry: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 24, color: "#10201E" }}>
        <title>PAUTA</title>
        <h1 style={{ fontSize: 24 }}>Não foi possível abrir esta página</h1>
        <p>Confira sua conexão e tente de novo. Se continuar, tente daqui a alguns minutos.</p>
        <button type="button" onClick={() => retry()} style={{ minHeight: 48, padding: "0 18px", fontWeight: 700, cursor: "pointer" }}>
          Tentar de novo
        </button>
      </body>
    </html>
  );
}
