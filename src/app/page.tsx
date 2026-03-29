"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, ClipboardPaste, ArrowRight, Loader2, RefreshCcw, CheckCircle2, AlertCircle } from "lucide-react";
import Image from "next/image";

export default function Home() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [userImage, setUserImage] = useState<string | null>(null);
  const [clotheImage, setClotheImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  
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
      } else {
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
    setLoadingText("Génération de l'essayage virtuel avec Nano Banana 2...");
    setErrorMsg(null);

    try {
      const res = await fetch('/api/generate-tryon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userImage, clotheImage })
      });
      
      if (!res.ok) {
        let errorText = `Erreur réseau: ${res.status}`;
        if (res.status === 413) {
           errorText = "L'image est trop lourde pour le serveur (Payload Too Large).";
        }
        throw new Error(errorText);
      }
      
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      
      setResultImage(data.resultImage);
      setStep(4);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Erreur lors de la génération. Veuillez réessayer.");
      setStep(2); // Retour à l'étape du vêtement
    }
  };

  const restart = () => {
    setStep(1);
    setUserImage(null);
    setClotheImage(null);
    setResultImage(null);
    setErrorMsg(null);
  };

  return (
    <div className="min-h-screen p-4 sm:p-8 flex flex-col items-center justify-center font-sans">
      <div className="w-full max-w-4xl flex flex-col items-center space-y-8">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-5xl font-light tracking-tight text-[var(--primary)]">
            Atelier Virtuel
          </h1>
          <p className="text-sm md:text-base opacity-70">
            Essayez les vêtements d'un simple copié-collé.
          </p>
        </div>

        {/* Dynamic Card Area */}
        <AnimatePresence mode="wait">
          {/* ETAPE 1 & 2 : UPLOAD */}
          {(step === 1 || step === 2) && (
            <motion.div 
              key="upload-phase"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-[var(--card)] w-full rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-[#e6dfd3]"
            >
              <div className="flex items-center justify-between mb-8 px-2">
                <span className="text-sm font-medium opacity-50 uppercase tracking-wider">
                  Étape {step} sur 2
                </span>
                <span className="text-sm font-medium">
                  {step === 1 ? "La Toile (Vous)" : "L'Œuvre (Le Vêtement)"}
                </span>
              </div>

              {errorMsg && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl flex items-start space-x-3 text-sm">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <p>{errorMsg}</p>
                </motion.div>
              )}

              <div className="grid md:grid-cols-2 gap-8 relative">
                {/* Zone Photo Utilisateur */}
                <div className={`flex flex-col space-y-4 transition-opacity duration-300 ${step === 2 ? 'opacity-50' : 'opacity-100'}`}>
                  <p className="font-medium text-lg">1. Votre photo</p>
                  
                  {userImage && step === 2 ? (
                    <div className="relative aspect-[3/4] w-full max-h-[400px] rounded-2xl overflow-hidden border border-[var(--border)] group">
                      <Image src={userImage} alt="Utilisateur" fill className="object-cover" />
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button onClick={restart} className="bg-white/90 text-black px-4 py-2 rounded-full text-sm font-medium backdrop-blur-sm">
                          Modifier
                        </button>
                      </div>
                    </div>
                  ) : (
                    <UploadZone 
                      title="Photo portrait ou plein pied"
                      isLoading={isLoading && step === 1}
                      onFileSelect={handleImageRead}
                      onPasteSelect={handleManualPaste}
                      fileInputRef={fileInputRef1}
                    />
                  )}
                </div>

                {/* Zone Photo Vêtement */}
                <div className={`flex flex-col space-y-4 transition-opacity duration-300 ${step === 1 ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
                  <p className="font-medium text-lg">2. Le vêtement (ex: Zara)</p>
                  
                  {clotheImage ? (
                    <div className="relative aspect-[3/4] w-full max-h-[400px] rounded-2xl overflow-hidden border border-[var(--border)] group">
                      <Image src={clotheImage} alt="Vêtement" fill className="object-cover" />
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button onClick={() => setClotheImage(null)} className="bg-white/90 text-black px-4 py-2 rounded-full text-sm font-medium backdrop-blur-sm">
                          Modifier
                        </button>
                      </div>
                    </div>
                  ) : (
                    <UploadZone 
                      title="Photo catalogue du vêtement"
                      isLoading={false}
                      onFileSelect={handleImageRead}
                      onPasteSelect={handleManualPaste}
                      fileInputRef={fileInputRef2}
                    />
                  )}
                </div>
              </div>

              {step === 2 && clotheImage && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-8 flex justify-center">
                  <button 
                    onClick={handleGenerate}
                    className="bg-[var(--primary)] text-white px-8 py-4 rounded-full font-medium flex items-center space-x-2 hover:opacity-90 transition-opacity"
                  >
                    <span>Générer l'Essayage Magique</span>
                    <ArrowRight className="w-5 h-5" />
                  </button>
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
              className="py-24 flex flex-col items-center justify-center space-y-6"
            >
              <div className="relative">
                <div className="absolute inset-0 rounded-full border-t-2 border-[var(--primary)] animate-spin" style={{ animationDuration: '3s' }}/>
                <Loader2 className="w-12 h-12 animate-spin text-[var(--primary)]/30" />
              </div>
              <p className="text-xl font-light text-center max-w-sm animate-pulse">
                {loadingText}
              </p>
            </motion.div>
          )}

          {/* ETAPE 4 : RESULTAT */}
          {step === 4 && resultImage && (
            <motion.div 
              key="result-phase"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-lg mx-auto bg-white p-4 rounded-[2rem] shadow-2xl"
            >
              <div className="relative aspect-[3/4] w-full rounded-3xl overflow-hidden mb-6">
                <Image src={resultImage} alt="Résultat d'essayage" fill className="object-cover" />
              </div>
              
              <div className="flex flex-col sm:flex-row items-center justify-between px-2 gap-4">
                <div className="flex items-center space-x-2 text-green-700">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="text-sm font-medium">Génération terminée</span>
                </div>
                
                <button 
                  onClick={restart}
                  className="flex items-center space-x-2 bg-[var(--card)] hover:bg-[#e6dfd3] px-6 py-3 rounded-full text-sm font-medium transition-colors w-full sm:w-auto justify-center"
                >
                  <RefreshCcw className="w-4 h-4" />
                  <span>Essayer un autre</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}

// Composant Dropzone mutualisé
function UploadZone({ title, isLoading, onFileSelect, onPasteSelect, fileInputRef }: any) {
  return (
    <div className="border-2 border-dashed border-[var(--border)] rounded-2xl p-8 flex flex-col items-center justify-center text-center aspect-[3/4] max-h-[400px] relative overflow-hidden bg-white/50 hover:bg-white/80 transition-colors group">
      {isLoading ? (
        <div className="flex flex-col items-center space-y-3 opacity-60">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm font-medium">Validation...</p>
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
          <div className="w-16 h-16 rounded-full bg-[var(--card)] flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <Upload className="w-7 h-7 opacity-70" />
          </div>
          <p className="font-medium text-[var(--foreground)] mb-1">{title}</p>
          <p className="text-sm opacity-50 mb-6">Fichier JPG ou PNG</p>
          
          <div className="flex flex-col w-full gap-3 px-4">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="bg-white border hover:bg-gray-50 text-[var(--foreground)] px-4 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm"
            >
              Parcourir
            </button>
            <button 
              onClick={onPasteSelect}
              className="bg-[var(--primary)] text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors flex items-center justify-center space-x-2 shadow-sm"
            >
              <ClipboardPaste className="w-4 h-4" />
              <span>Coller l'image</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
