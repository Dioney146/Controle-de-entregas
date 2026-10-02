// Fonte Poppins hospedada no próprio site (com negrito de verdade = letras nítidas)
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "./globals.css";
import Casca from "../components/Casca";

export const metadata = {
  title: "Controle de Entregas · Delly's",
  description: "Programação, frete, saídas, retorno e histórico de entregas — Roteirização AM",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>
        <Casca>{children}</Casca>
      </body>
    </html>
  );
}
