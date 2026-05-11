import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
    variable: "--font-sans",
    subsets: ["latin"],
    display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
    variable: "--font-mono",
    subsets: ["latin"],
    display: "swap",
    weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
    title: "Atelier Virtuel — AI virtual try-on",
    description:
        "Upload a photo of yourself and a photo of a garment. The AI composites the clothing onto your body in five seconds. Free public demo built on Gemini 3 Flash Image. Photos never leave the request — no storage, no tracking.",
    keywords: ["virtual try-on", "AI fashion", "Gemini", "Next.js", "demo"],
    openGraph: {
        title: "Atelier Virtuel — AI virtual try-on",
        description:
            "Free AI virtual try-on demo. Upload a selfie + a clothing photo, get a composited result in seconds.",
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: "Atelier Virtuel — AI virtual try-on",
        description: "Free AI virtual try-on demo. Built on Gemini 3 Flash Image.",
    },
    icons: {
        icon: [
            {
                url:
                    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%231A1A1A'/%3E%3Crect x='14' y='14' width='36' height='36' fill='%23CCFF00'/%3E%3Ctext x='32' y='44' font-family='Helvetica,Arial,sans-serif' font-size='30' font-weight='900' fill='%231A1A1A' text-anchor='middle'%3EA%3C/text%3E%3C/svg%3E",
                type: "image/svg+xml",
            },
        ],
    },
};

export const viewport: Viewport = {
    themeColor: "#1A1A1A",
    width: "device-width",
    initialScale: 1,
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html
            lang="en"
            className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
        >
            <body className="min-h-full flex flex-col">{children}</body>
        </html>
    );
}
