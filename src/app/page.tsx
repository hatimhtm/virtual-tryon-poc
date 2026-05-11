"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, ClipboardPaste, ArrowRight, Loader2, RefreshCcw, CheckCircle2, AlertCircle, Camera, Building2, Leaf, Palette, Lightbulb } from "lucide-react";
import Image from "next/image";

const BACKGROUND_PRESETS = [
  { key: "studio_white", label: "Studio Blanc", icon: Camera },
  { key: "studio_gray", label: "Studio Gris", icon: Camera },
  { key: "minimal_beige", label: "Intérieur Beige", icon: Palette },
  { key: "urban", label: "Urbain", icon: Building2 },
  { key: "outdoor_nature", label: "Nature", icon: Leaf },
];

export default function Home() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [userImage, setUserImage] = useState<string | null>(null);
  const [clotheImage, setClotheImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  
  const [background, setBackground] = useState("studio_white");
  const [validationTips, setValidationTips] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef1 = useRef<HTMLInputElement>(null);
  const fileInputRef2 = useRef<HTMLInputElement>(null);

  // Gérer le collage global (Ctrl+V ou Cmd+V)
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      e.preventDefault();
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            handleImageRead(blob);
          }
          break;
        }
      }
    };
    
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [step]); // Readjust based on step

  const compressImage = (file: File | Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = document.createElement('img');
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          // Max dimensions
          const MAX_SIZE = 1024;
          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          // Reduce Quality to 0.7 for WEBP/JPEG to ensure < 1MB
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve(dataUrl);
        };
        img.onerror = (e) => reject(e);
      };
      reader.onerror = (e) => reject(e);
    });
  };

  const handleImageRead = async (file: File | Blob) => {
    setErrorMsg(null);
    try {
      if (step === 1) {
        setIsLoading(true); // Afficher direct un loader pendant la compression
        setLoadingText("Compression de l'image...");
      }
      
      const compressedBase64 = await compressImage(file);
      
      if (step === 1) {
        processUserImage(compressedBase64);
      } else if (step === 2) {
        setClotheImage(compressedBase64);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg("Erreur lors de la lecture ou compression de l'image.");
      if (step === 1) setIsLoading(false);
    }
  };

  const processUserImage = async (base64: string) => {
    setIsLoading(true);
    setLoadingText("Analyse de la photo avec Gemini Vision...");
    setUserImage(base64); // Afficher temporairement mais empêcher la suite tant que pas validé
    
    try {
      const res = await fetch('/api/validate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 })
      });
      
      if (!res.ok) {
        throw new Error(`Erreur serveur: ${res.status}`);
      }
      
      const data = await res.json();
      
      if (data.isValid === false) {
        setUserImage(null);
        setErrorMsg(data.reason || "Photo non valide. Veuillez réessayer.");
        setValidationTips(data.tips || []);
      } else {
        setValidationTips(data.tips || []);
        setStep(2);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg("Erreur lors de la validation. Essayez une autre photo.");
      setUserImage(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualPaste = async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const clipboardItem of clipboardItems) {
        const imageTypes = clipboardItem.types.filter(type => type.startsWith('image/'));
        if (imageTypes.length > 0) {
          const blob = await clipboardItem.getType(imageTypes[0]);
          handleImageRead(blob);
          return;
        }
      }
      setErrorMsg("Aucune image trouvée dans le presse-papier.");
    } catch (err) {
      console.error(err);
      setErrorMsg("Impossible de lire le presse-papier. Utilisez l'upload classique.");
    }
  };

  const handleGenerate = async () => {
    if (!userImage || !clotheImage) return;
    
    setStep(3);
    setLoadingText("Génération de l'essayage virtuel en cours...");
    setErrorMsg(null);

    try {
      const res = await fetch('/api/generate-tryon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userImage, clotheImage, background })
      });
      
      if (!res.ok) {
        let errorText = `Erreur réseau: ${res.status}`;
        try {
          const errData = await res.json();
          if (errData.error) errorText = errData.error;
        } catch (e) {
             // Ignore if it's not JSON
        }
        if (res.status === 413) {
           errorText = "L'image est trop lourde pour le serveur (Payload Too Large).";
        }
        if (res.status === 504) {
           errorText = "Le serveur Vercel a mis trop de temps à répondre (Timeout).";
        }
        throw new Error(errorText);
      }
      
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      
      setResultImage(data.resultImage);
      setStep(4);
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Erreur lors de la génération. Veuillez réessayer.";
      setErrorMsg(message);
      setStep(2); // Retour à l'étape du vêtement
    }
  };

  const restart = () => {
    setStep(1);
    setUserImage(null);
    setClotheImage(null);
    setResultImage(null);
    setErrorMsg(null);
    setValidationTips([]);
    setBackground("studio_white");
  };

  return (
    <div className="min-h-screen p-4 sm:p-8 flex flex-col items-center font-sans">
      <div className="w-full max-w-4xl flex flex-col items-center space-y-8 pt-8 pb-16">

        {/* Header */}
        <header className="w-full text-center space-y-3">
          <p className="font-mono text-[10px] sm:text-xs font-bold tracking-[0.25em] uppercase text-[var(--muted)]">
            {"/// AI VIRTUAL TRY-ON · FREE PUBLIC DEMO · POWERED BY GEMINI 3 ///"}
          </p>
          <h1 className="font-sans text-5xl sm:text-7xl font-black tracking-tighter text-[var(--foreground)]">
            ATELIER<span className="text-[var(--accent)] bg-[var(--foreground)] px-2 ml-1 inline-block leading-none">.</span>
          </h1>
          <p className="text-sm sm:text-base max-w-xl mx-auto text-[var(--muted)]">
            Upload a selfie, drop in a clothing photo, see the garment on you in seconds.<br className="hidden sm:inline" />
            <span className="font-mono text-xs">FR-language interface · 5 generations / hour / IP · photos never stored</span>
          </p>
        </header>

        {/* Dynamic Card Area */}
        <AnimatePresence mode="wait">
          {/* ETAPE 1 & 2 : UPLOAD */}
          {(step === 1 || step === 2) && (
            <motion.div
              key="upload-phase"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-[var(--card)] w-full p-6 sm:p-8 border-2 border-[var(--border)] shadow-brutal"
            >
              {/* Step rail */}
              <div className="flex items-center justify-between mb-6 font-mono text-[11px] sm:text-xs uppercase tracking-wider">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 ${step >= 1 ? "bg-[var(--foreground)] text-[var(--background)]" : "bg-transparent text-[var(--muted)]"}`}>
                    01·VOUS
                  </span>
                  <span className="text-[var(--muted)]">───</span>
                  <span className={`px-2 py-1 ${step >= 2 ? "bg-[var(--foreground)] text-[var(--background)]" : "bg-transparent text-[var(--muted)]"}`}>
                    02·VÊTEMENT
                  </span>
                  <span className="text-[var(--muted)] hidden sm:inline">───</span>
                  <span className="px-2 py-1 bg-transparent text-[var(--muted)] hidden sm:inline">03·RÉSULTAT</span>
                </div>
                <span className="font-bold hidden sm:inline">
                  {step === 1 ? "LA TOILE" : "L'ŒUVRE"}
                </span>
              </div>

              {errorMsg && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6 p-4 bg-[#FF3399]/10 text-[#FF3399] border-2 border-[#FF3399] flex items-start gap-3 text-sm">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-bold uppercase tracking-wide text-[11px] mb-1 font-mono">ERROR</p>
                    <p>{errorMsg}</p>
                    {validationTips.length > 0 && (
                      <ul className="mt-2 space-y-1 list-disc list-inside opacity-80">
                        {validationTips.map((tip, i) => <li key={i}>{tip}</li>)}
                      </ul>
                    )}
                  </div>
                </motion.div>
              )}

              {!errorMsg && validationTips.length > 0 && step === 2 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6 p-4 bg-[var(--accent)]/30 text-[var(--foreground)] border-2 border-[var(--foreground)] flex items-start gap-3 text-sm">
                  <Lightbulb className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold uppercase tracking-wide text-[11px] mb-1 font-mono">TIPS · BETTER RESULT</p>
                    <ul className="space-y-1 list-disc list-inside">
                      {validationTips.map((tip, i) => <li key={i}>{tip}</li>)}
                    </ul>
                  </div>
                </motion.div>
              )}

              <div className="grid md:grid-cols-2 gap-6 relative">
                {/* Zone Photo Utilisateur */}
                <div className={`flex flex-col gap-3 transition-opacity duration-300 ${step === 2 ? 'opacity-60' : 'opacity-100'}`}>
                  <p className="font-mono text-xs font-bold uppercase tracking-wider">01 · VOTRE PHOTO</p>

                  {userImage && step === 2 ? (
                    <div className="relative aspect-[3/4] w-full max-h-[400px] overflow-hidden border-2 border-[var(--border)] group">
                      <Image src={userImage} alt="Utilisateur" fill className="object-cover" />
                      <div className="absolute inset-0 bg-[var(--foreground)]/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button onClick={restart} className="bg-[var(--accent)] text-[var(--accent-foreground)] px-4 py-2 text-sm font-bold uppercase tracking-wide font-mono border-2 border-[var(--foreground)] shadow-brutal-sm">
                          Modifier
                        </button>
                      </div>
                    </div>
                  ) : (
                    <UploadZone
                      title="Portrait ou plein pied"
                      isLoading={isLoading && step === 1}
                      onFileSelect={handleImageRead}
                      onPasteSelect={handleManualPaste}
                      fileInputRef={fileInputRef1}
                    />
                  )}
                </div>

                {/* Zone Photo Vêtement */}
                <div className={`flex flex-col gap-3 transition-opacity duration-300 ${step === 1 ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
                  <p className="font-mono text-xs font-bold uppercase tracking-wider">02 · LE VÊTEMENT</p>

                  {clotheImage ? (
                    <div className="relative aspect-[3/4] w-full max-h-[400px] overflow-hidden border-2 border-[var(--border)] group">
                      <Image src={clotheImage} alt="Vêtement" fill className="object-cover" />
                      <div className="absolute inset-0 bg-[var(--foreground)]/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button onClick={() => setClotheImage(null)} className="bg-[var(--accent)] text-[var(--accent-foreground)] px-4 py-2 text-sm font-bold uppercase tracking-wide font-mono border-2 border-[var(--foreground)] shadow-brutal-sm">
                          Modifier
                        </button>
                      </div>
                    </div>
                  ) : (
                    <UploadZone
                      title="Photo catalogue (Zara, ASOS…)"
                      isLoading={false}
                      onFileSelect={handleImageRead}
                      onPasteSelect={handleManualPaste}
                      fileInputRef={fileInputRef2}
                    />
                  )}
                </div>
              </div>

              {step === 2 && clotheImage && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-8 space-y-6">
                  {/* Sélecteur de fond */}
                  <div className="space-y-3">
                    <p className="font-mono text-xs font-bold uppercase tracking-wider">DÉCOR DE FOND</p>
                    <div className="flex flex-wrap gap-2">
                      {BACKGROUND_PRESETS.map((preset) => (
                        <button
                          key={preset.key}
                          onClick={() => setBackground(preset.key)}
                          className={`flex items-center gap-2 px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all border-2 ${
                            background === preset.key
                              ? 'bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)] shadow-brutal-sm'
                              : 'bg-[var(--background)] text-[var(--foreground)] border-[var(--foreground)] hover:bg-[var(--accent)]/30'
                          }`}
                        >
                          <preset.icon className="w-3.5 h-3.5" />
                          <span>{preset.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-center pt-2">
                    <button
                      onClick={handleGenerate}
                      className="bg-[var(--foreground)] text-[var(--background)] px-8 py-4 font-bold tracking-wide flex items-center gap-3 border-2 border-[var(--foreground)] shadow-brutal hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-brutal-sm transition-all uppercase text-sm font-mono"
                    >
                      <span>Générer l&apos;essayage</span>
                      <ArrowRight className="w-5 h-5" />
                    </button>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* ETAPE 3 : CHARGEMENT */}
          {step === 3 && (
            <motion.div
              key="loading-phase"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="w-full max-w-md py-16 px-8 flex flex-col items-center justify-center gap-6 bg-[var(--card)] border-2 border-[var(--border)] shadow-brutal"
            >
              <div className="w-32 h-32 relative border-2 border-[var(--foreground)] overflow-hidden">
                <div className="absolute inset-0 bg-[var(--accent)]/40" />
                <div className="absolute inset-x-0 h-1 bg-[var(--accent)] animate-scan" style={{ boxShadow: '0 0 18px var(--accent)' }} />
                <Loader2 className="absolute inset-0 m-auto w-10 h-10 animate-spin text-[var(--foreground)]" />
              </div>
              <div className="text-center space-y-2">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--muted)]">
                  {"/// GEMINI 3.1 FLASH IMAGE ///"}
                </p>
                <p className="font-bold text-lg tracking-tight">
                  {loadingText}
                </p>
                <p className="font-mono text-xs text-[var(--muted)]">~30–45s · ne ferme pas la page</p>
              </div>
            </motion.div>
          )}

          {/* ETAPE 4 : RESULTAT */}
          {step === 4 && resultImage && (
            <motion.div
              key="result-phase"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-lg mx-auto bg-[var(--card)] p-4 border-2 border-[var(--border)] shadow-brutal"
            >
              <div className="relative aspect-[3/4] w-full overflow-hidden border-2 border-[var(--foreground)] mb-4">
                <Image src={resultImage} alt="Résultat d'essayage" fill className="object-cover" />
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-1">
                <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider">
                  <CheckCircle2 className="w-4 h-4 text-[var(--accent-foreground)]" style={{ background: 'var(--accent)', borderRadius: 0 }} />
                  <span className="font-bold">GÉNÉRATION TERMINÉE</span>
                </div>

                <div className="flex gap-2">
                  <a
                    href={resultImage}
                    download="atelier-virtuel.png"
                    className="flex items-center gap-2 bg-[var(--accent)] text-[var(--accent-foreground)] px-4 py-2 border-2 border-[var(--foreground)] font-mono text-xs font-bold uppercase tracking-wider shadow-brutal-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
                  >
                    Télécharger
                  </a>
                  <button
                    onClick={restart}
                    className="flex items-center gap-2 bg-[var(--foreground)] text-[var(--background)] px-4 py-2 border-2 border-[var(--foreground)] font-mono text-xs font-bold uppercase tracking-wider shadow-brutal-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
                  >
                    <RefreshCcw className="w-3.5 h-3.5" />
                    <span>Nouveau</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}

// Composant Dropzone mutualisé
interface UploadZoneProps {
  title: string;
  isLoading: boolean;
  onFileSelect: (file: File | Blob) => void;
  onPasteSelect: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}
function UploadZone({ title, isLoading, onFileSelect, onPasteSelect, fileInputRef }: UploadZoneProps) {
  return (
    <div className="border-2 border-dashed border-[var(--foreground)] p-6 flex flex-col items-center justify-center text-center aspect-[3/4] max-h-[400px] relative overflow-hidden bg-[var(--background)] hover:bg-[var(--accent)]/15 transition-colors group">
      {isLoading ? (
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="font-mono text-xs uppercase tracking-wider font-bold">VALIDATION GEMINI…</p>
        </div>
      ) : (
        <>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={fileInputRef}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                onFileSelect(e.target.files[0]);
              }
            }}
          />
          <div className="w-14 h-14 bg-[var(--foreground)] text-[var(--background)] flex items-center justify-center mb-4 group-hover:bg-[var(--accent)] group-hover:text-[var(--accent-foreground)] transition-colors">
            <Upload className="w-6 h-6" strokeWidth={2.5} />
          </div>
          <p className="font-bold text-[var(--foreground)] mb-1">{title}</p>
          <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--muted)] mb-5">JPG · PNG · WEBP</p>

          <div className="flex flex-col w-full gap-2 max-w-[220px]">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-[var(--background)] border-2 border-[var(--foreground)] text-[var(--foreground)] px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider shadow-brutal-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
            >
              Parcourir
            </button>
            <button
              onClick={onPasteSelect}
              className="bg-[var(--foreground)] text-[var(--background)] border-2 border-[var(--foreground)] px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-brutal-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              <span>Coller (⌘V)</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
