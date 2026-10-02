import localFont from "next/font/local";
import "./globals.css";
import Casca from "../components/Casca";

// Fonte Poppins guardada no próprio site (pasta app/fontes), com negrito de verdade = letras nítidas
const poppins = localFont({
  src: [
    { path: "./fontes/poppins-400.woff2", weight: "400", style: "normal" },
    { path: "./fontes/poppins-500.woff2", weight: "500", style: "normal" },
    { path: "./fontes/poppins-600.woff2", weight: "600", style: "normal" },
    { path: "./fontes/poppins-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--fonte",
});

export const metadata = {
  title: "Controle de Entregas · Delly's",
  description: "Programação, frete, saídas, retorno e histórico de entregas — Roteirização AM",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" className={poppins.variable}>
      <body>
        <Casca>{children}</Casca>
      </body>
    </html>
  );
}
