import type { Metadata } from 'next';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Planificador Definitivo de Agenda FBF – Cyber Octubre 2026',
  description: 'Planificación operacional de ingresos a Fulfillment by Falabella por number, fecha y capacidad.',
  openGraph: {
    title: 'Planificador Definitivo de Agenda FBF',
    description: 'Cyber Octubre 2026 · Planificación operacional por number, fecha y capacidad.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Planificador Definitivo de Agenda FBF',
    description: 'Cyber Octubre 2026 · Planificación operacional por number, fecha y capacidad.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body className="antialiased">{children}</body></html>;
}
