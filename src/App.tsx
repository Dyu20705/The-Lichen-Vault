import { useState, useEffect } from "react";
import { BookOpen, Wind, Eye, ShieldAlert } from "lucide-react";
import { LichenOrganism, BreathRecording } from "./types";
import { generateLichenFromBreaths } from "./utils/generator";
import { BreathRitual } from "./components/BreathRitual";
import { VaultCabinet } from "./components/VaultCabinet";
import { LichenRenderer } from "./components/LichenRenderer";
import { LocalStorageSpecimenRepository, RecoverySnapshot } from "./infrastructure/persistence/localStorageSpecimenRepository";

const repository = new LocalStorageSpecimenRepository();

export default function App() {
  const [view, setView] = useState<"landing" | "ritual" | "germinating" | "reveal" | "vault">("landing");
  const [organisms, setOrganisms] = useState<LichenOrganism[]>([]);
  const [newlyGerminated, setNewlyGerminated] = useState<LichenOrganism | null>(null);
  const [mitosisProgress, setMitosisProgress] = useState<number>(0);
  const [recoverySnapshot, setRecoverySnapshot] = useState<RecoverySnapshot | null>(null);

  // Load deposited ones from the secure LocalStorageSpecimenRepository on launch
  useEffect(() => {
    async function initArchive() {
      try {
        const list = await repository.listSpecimens();
        setOrganisms(list);
        setRecoverySnapshot(null);
      } catch (error) {
        console.error("Local storage index corruption detected, entering degraded containment:", error);
        setRecoverySnapshot(repository.getRecoverySnapshot(error) ?? {
          storageKey: "lichen_vault_flora",
          rawPayload: null,
          errorCode: "UNKNOWN_STORAGE_ERROR",
          reason: error instanceof Error ? error.message : "Failed to parse underlying JSON storage.",
          recoverability: "recoverable"
        });
      }
    }
    initArchive();
  }, []);

  const retryArchiveLoad = async () => {
    try {
      const list = await repository.listSpecimens();
      setOrganisms(list);
      setRecoverySnapshot(null);
    } catch (error) {
      setRecoverySnapshot(repository.getRecoverySnapshot(error) ?? recoverySnapshot);
    }
  };

  const handleBeginDeposit = () => {
    setView("ritual");
  };

  const handleCancelRitual = () => {
    setView("landing");
  };

  // Callback once user completes the three breaths
  const handleBreathCompleted = (recordings: BreathRecording[]) => {
    setView("germinating");
    setMitosisProgress(0);

    // Simulate slow mysterious process of structural cell division
    const newOrganism = generateLichenFromBreaths(recordings);
    setNewlyGerminated(newOrganism);

    const interval = setInterval(() => {
      setMitosisProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          
          // Complete and persist through repository layer
          repository.saveSpecimen(newOrganism)
            .then(() => repository.listSpecimens())
            .then((list) => {
              setOrganisms(list);
              setRecoverySnapshot(null);
            })
            .catch((e) => {
              console.error("Failed to save virtual specimen thallus:", e);
              setRecoverySnapshot(repository.getRecoverySnapshot(e) ?? {
                storageKey: "lichen_vault_flora",
                rawPayload: null,
                errorCode: "SPECIMEN_SAVE_FAILED",
                reason: e instanceof Error ? e.message : "Failed to save specimen.",
                recoverability: "recoverable"
              });
            });
          
          // Transition to the reveal step
          setTimeout(() => {
            setView("reveal");
          }, 600);
          return 100;
        }
        return prev + 4;
      });
    }, 120);
  };

  const handleUpdateOrganismInVault = async (updated: LichenOrganism) => {
    try {
      await repository.saveSpecimen(updated);
      const list = await repository.listSpecimens();
      setOrganisms(list);
      setRecoverySnapshot(null);
    } catch (error) {
      console.error("Failed to commit specimen update:", error);
      setRecoverySnapshot(repository.getRecoverySnapshot(error) ?? {
        storageKey: "lichen_vault_flora",
        rawPayload: null,
        errorCode: "SPECIMEN_UPDATE_FAILED",
        reason: error instanceof Error ? error.message : "Failed to commit specimen update.",
        recoverability: "recoverable"
      });
    }
  };

  const handleWipeAndResetVault = () => {
    if (window.confirm("CRITICAL WARNING: This intentionally resets the local vault storage in this browser. Corrupted raw payloads will be deleted. Continue?")) {
      repository.resetStorage();
      setOrganisms([]);
      setRecoverySnapshot(null);
    }
  };

  const handleCopyRawPayload = async () => {
    if (!recoverySnapshot?.rawPayload) return;
    await navigator.clipboard.writeText(recoverySnapshot.rawPayload);
  };

  // Reveal step transitions smoothly into the main vault inspect chambers
  const handleTransitionToVault = () => {
    setView("vault");
    setNewlyGerminated(null);
  };

  return (
    <div className="min-h-screen bg-[#050805] text-[#d4d4c8] font-serif flex relative selection:bg-[#ffbf00]/30 selection:text-white">
      
      {/* Decorative Grid Overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] z-0 editorial-grid-bg" />

      {/* Left Vertical Rail: System Metadata (Hidden on very narrow mobile screens to stay pristine) */}
      <div className="hidden sm:flex w-16 border-r border-[#2d4f2d]/30 flex-col items-center py-8 justify-between z-20 bg-[#050805]/95 shrink-0 select-none">
        <div className="[writing-mode:vertical-rl] rotate-180 text-[10px] uppercase tracking-[0.4em] text-[#d4d4c8]/40 font-sans">
          Sequence: LV-8829-X
        </div>
        <div className="w-[1px] h-32 bg-gradient-to-b from-transparent via-[#ffbf00]/20 to-transparent"></div>
        <div className="[writing-mode:vertical-rl] rotate-180 text-[10px] uppercase tracking-[0.4em] text-[#d4d4c8]/40 font-sans">
          Vault Protocol Alpha
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col justify-between py-10 px-4 sm:px-8 relative min-h-screen z-10 overflow-hidden">
        
        {/* BACKGROUND GRAPHICS: Floating Ambient Glass Spheres & Radial Gas Glows */}
        <div className="absolute top-24 left-[10%] w-[35rem] h-[35rem] ambient-glow-1 rounded-full pointer-events-none select-none -translate-x-1/2 -translate-y-1/2 blur-2xl z-0" />
        <div className="absolute bottom-24 right-[15%] w-[40rem] h-[40rem] ambient-glow-2 rounded-full pointer-events-none select-none translate-x-1/3 translate-y-1/3 blur-2xl z-0" />

        {/* Floating glass orb illustration 1 (Editorial styled amber/gold sphere) */}
        <div className="absolute top-[18%] right-[12%] w-24 h-24 rounded-full border border-[#ffbf00]/10 bg-[#16120b]/30 backdrop-blur-sm glow-amber animate-drift pointer-events-none select-none hidden md:block z-0">
          <div className="absolute top-2 left-6 w-12 h-[1px] bg-gradient-to-r from-transparent via-[#ffbf00]/25 to-transparent" />
          <div className="absolute inset-5 border border-[#ffbf00]/5 rounded-full" />
        </div>

        {/* Floating glass orb illustration 2 (Editorial style green thallus sphere) */}
        <div className="absolute bottom-[20%] left-[8%] w-36 h-36 rounded-full border border-[#2d4f2d]/20 bg-[#050805]/40 backdrop-blur-md glow-green animate-drift pointer-events-none select-none hidden lg:block z-0" style={{ animationDelay: "3s" }}>
          <div className="absolute top-3 left-10 w-16 h-[1.5px] bg-gradient-to-r from-transparent via-[#8ba18b]/20 to-transparent" />
          <div className="absolute inset-8 border border-[#2d4f2d]/10 rounded-full" />
        </div>

        {/* MAIN CONTAINER HEADER */}
        <header className="max-w-6xl mx-auto w-full flex items-center justify-between text-center border-b border-[#2d4f2d]/30 pb-4 z-10 relative">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 border border-[#2d4f2d]/45 flex items-center justify-center bg-[#050805] font-serif italic text-xs text-[#ffbf00] select-none cursor-pointer hover:border-[#ffbf00]/50 hover:bg-[#ffbf00]/5 transition-all text-center leading-8" onClick={() => setView("landing")}>
              Ψ
            </div>
            <div className="text-left select-none font-serif">
              <h1 className="text-lg tracking-[0.22em] font-light text-[#d4d4c8] uppercase">
                The Lichen Vault
              </h1>
              <p className="font-sans text-[8px] tracking-[0.15em] text-[#8ba18b] uppercase">
                Cryo-Biological Respiration Bank
              </p>
            </div>
          </div>

          {/* Floating vault capacity stats */}
          <div className="font-sans text-[9px] text-[#8ba18b] tracking-widest text-right select-none">
            VAULT STATUS: <span className="text-[#ffbf00] font-semibold">ACTIVE</span> // {organisms.length} PRESERVED // SEC_A
          </div>
        </header>

        {/* MAIN DYNAMIC CONTENT SCREEN */}
        <main className="flex-1 max-w-6xl mx-auto w-full flex items-center justify-center z-10 py-12 relative">
          
          {recoverySnapshot ? (
            // CORRUPTED DATABASE MATRIX RECOVERY FRAMEWORK
            <div id="compromised_vault_viewport" className="text-center max-w-xl mx-auto flex flex-col items-center justify-center p-8 border border-red-950/40 bg-black/80 rounded-xl py-12 relative z-50 animate-fade-in font-serif">
              <div className="w-20 h-20 rounded-full border border-red-500/35 bg-red-950/15 flex items-center justify-center mb-6">
                <ShieldAlert className="w-10 h-10 text-red-500 animate-pulse" />
              </div>
              <p className="font-sans text-red-500 uppercase text-[11px] tracking-[0.3em] font-semibold mb-2">
                SYSTEM CORRUPTION FLAG TRIGGERED
              </p>
              <h2 className="text-3xl font-light text-[#d4d4c8] leading-tight tracking-wide mb-4">
                HERMETIC SEAL BREACH DETECTED
              </h2>
              <p className="font-sans text-xs text-[#8ba18b] uppercase tracking-widest mb-6">
                Atmosphere status: DEGRADED & COMPROMISED
              </p>
              <div className="bg-[#050805] border border-red-950/40 p-4 rounded text-left font-mono text-[9.5px] leading-relaxed text-red-400 max-h-56 overflow-y-auto mb-8 w-full select-all">
                <div>Storage key: {recoverySnapshot.storageKey}</div>
                <div>Error code: {recoverySnapshot.errorCode}</div>
                <div>Recoverability: {recoverySnapshot.recoverability}</div>
                <div>Reason: {recoverySnapshot.reason}</div>
                <div className="mt-3 text-[#d4d4c8]/80 whitespace-pre-wrap">
                  {recoverySnapshot.rawPayload ?? "No raw payload was available."}
                </div>
              </div>
              <p className="font-serif italic text-xs text-[#d4d4c8]/70 max-w-md mb-8">
                "An unexpected interference wave has breached the capsule's carbon structure. Original specimens could not be safely read or translated. If the raw storage data cannot be recovered, a fresh atmospheric initialization is required to restore the seal."
              </p>
              <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
                <button
                  onClick={retryArchiveLoad}
                  className="border border-[#ffbf00]/40 text-[#ffbf00] font-sans py-3.5 px-6 rounded-sm hover:bg-[#ffbf00]/10 transition-all font-mono text-[10px] tracking-widest uppercase cursor-pointer bg-transparent"
                >
                  RETRY PARSE
                </button>
                <button
                  onClick={handleCopyRawPayload}
                  className="border border-[#2d4f2d]/50 text-[#8ba18b] font-sans py-3.5 px-6 rounded-sm hover:bg-[#d4d4c8]/5 transition-all font-mono text-[10px] tracking-widest uppercase cursor-pointer bg-transparent"
                >
                  COPY RAW DATA
                </button>
                <button
                  onClick={() => setRecoverySnapshot(null)}
                  className="border border-[#2d4f2d]/50 text-[#8ba18b] font-sans py-3.5 px-6 rounded-sm hover:bg-[#d4d4c8]/5 transition-all font-mono text-[10px] tracking-widest uppercase cursor-pointer bg-transparent"
                >
                  IGNORE & DISMISS WARNING
                </button>
                <button
                  onClick={handleWipeAndResetVault}
                  className="border border-red-500/40 text-red-400 font-sans py-3.5 px-6 rounded-sm hover:bg-red-950/30 transition-all font-mono text-[10px] tracking-widest uppercase cursor-pointer bg-transparent"
                >
                  RESET STORAGE
                </button>
              </div>
            </div>
          ) : (
            <>
              {view === "landing" && (
            // ================= STEP 1: LANDING PAGE =================
            <div id="landing_viewport" className="text-center max-w-2xl mx-auto flex flex-col items-center justify-center py-6 animate-fade-in font-serif">
              {/* Visual focus element: Large glowing floating specimen dome */}
              <div className="w-64 h-64 rounded-full border border-[#2d4f2d]/30 bg-radial-gradient from-black via-[#050805]/95 to-black p-4 relative flex items-center justify-center glow-green mb-10 group cursor-pointer animate-slow-breathing">
                <div className="absolute top-[4%] left-[10%] right-[10%] h-[3px] bg-gradient-to-r from-transparent via-[#d4d4c8]/20 to-transparent rounded-full pointer-events-none" />
                {/* Subtle pulsing spore grid */}
                <div className="absolute inset-5 border border-[#2d4f2d]/25 rounded-full" />
                <div className="absolute inset-10 border border-[#2d4f2d]/10 rounded-full" />
                
                {/* Floating inner node */}
                <div className="w-16 h-16 rounded-full bg-[#ffbf00]/10 border border-[#ffbf00]/25 flex flex-col items-center justify-center glow-amber scale-102">
                  <Wind className="w-5 h-5 text-[#ffbf00]/80 animate-pulse" />
                </div>

                <div className="absolute bottom-4 font-sans text-[8px] text-[#8ba18b]/60 tracking-widest uppercase">
                  Awaiting Respiration Source
                </div>
              </div>

              <p className="font-sans text-[#ffbf00] uppercase text-xs tracking-[0.4em] font-medium mb-3">
                <span className="w-2 h-2 rounded-full bg-[#ffbf00] inline-block mr-2 animate-pulse" />
                SECURE CHAMBER // DEPOSIT LEDGER
              </p>
              
              <h2 className="text-4xl sm:text-5xl lg:text-6xl font-light text-[#d4d4c8] leading-tight tracking-[0.08em] mb-6">
                TEMPORAL RESPIRATE SPECIMENS<br />
                <span className="italic font-light text-[#8ba18b]/90">Department of Vital Records</span>
              </h2>

              <p className="font-serif text-[#d4d4c8]/80 leading-relaxed text-sm sm:text-base max-w-xl italic mb-12">
                A hermetic repository designed to capture and hold biological wind volatiles. Seeding successive exhalations via physical copper membrane triggers the immediate cellular mitosis of digital thallus filaments. In containment, each fused specimen grows in deep time, translating forgotten chronology back into semantic memory.
              </p>

              <div className="flex flex-col sm:flex-row items-center gap-4 w-full justify-center max-w-md">
                <button
                  id="landing_begin_deposit_btn"
                  onClick={handleBeginDeposit}
                  className="w-full sm:w-auto border border-[#ffbf00]/30 py-4 px-8 text-[11px] uppercase tracking-[0.3em] text-[#ffbf00] hover:bg-[#ffbf00]/5 hover:border-[#ffbf00]/50 transition-colors duration-300 cursor-pointer flex items-center justify-center gap-2 relative overflow-hidden group select-none"
                >
                  <Wind className="w-4 h-4 shrink-0 transition-transform group-hover:translate-x-1" />
                  <span className="relative z-10">Initiate Deposition</span>
                </button>
                
                {organisms.length > 0 && (
                  <button
                    id="landing_view_vault_btn"
                    onClick={() => setView("vault")}
                    className="w-full sm:w-auto border border-[#2d4f2d]/50 py-4 px-8 text-[11px] uppercase tracking-[0.3em] text-[#d4d4c8]/95 hover:bg-[#d4d4c8]/5 hover:border-[#ffbf00]/50 transition-colors duration-300 cursor-pointer flex items-center justify-center gap-2 relative overflow-hidden select-none"
                  >
                    <BookOpen className="w-4 h-4 shrink-0 text-[#8ba18b]" />
                    <span className="relative z-10">Access Ledger ({organisms.length})</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {view === "ritual" && (
            // ================= STEP 2: BREATH RITUAL =================
            <div className="w-full animate-fade-in relative z-10">
              <BreathRitual
                onCompleted={handleBreathCompleted}
                onCancel={handleCancelRitual}
              />
            </div>
          )}

          {view === "germinating" && (
            // ================= STEP 3: MITOSIS LOADING PHASE =================
            <div id="germinating_viewport" className="text-center max-w-md mx-auto flex flex-col items-center justify-center py-10 animate-fade-in">
              <div className="w-32 h-32 rounded-full border border-[#2d4f2d]/30 bg-[#050805] flex items-center justify-center mb-8 relative">
                <div className="absolute inset-0 border border-[#ffbf00]/15 rounded-full animate-ping" />
                <div className="w-16 h-16 rounded-full border border-[#ffbf00]/30 bg-black flex items-center justify-center animate-spin">
                  <span className="text-[#ffbf00] font-serif text-[28px] italic leading-none">Ψ</span>
                </div>
              </div>

              {/* Simulated Mitosis Progress text */}
              <h3 className="font-serif text-2xl text-[#d4d4c8] font-light italic mb-2">
                Fusing Respiration Fibers...
              </h3>
              
              <div className="w-full bg-[#050805] border border-[#2d4f2d]/30 h-2 rounded-full overflow-hidden mb-4 p-0.5">
                <div
                  className="bg-[#ffbf00] h-full rounded-full transition-all duration-100 ease-out"
                  style={{ width: `${mitosisProgress}%` }}
                />
              </div>

              <div className="font-sans text-[9px] text-[#8ba18b] tracking-widest uppercase flex flex-col gap-1 select-none">
                <span>PROGRESS: {mitosisProgress}%</span>
                <span className="animate-pulse">SPATIAL SEEDS MUTATING L-SYSTEM COMPILER</span>
              </div>
            </div>
          )}

          {view === "reveal" && newlyGerminated && (
            // ================= STEP 4: INTRODUCTORY SPECIES REVEAL =================
            <div id="geminated_reveal_viewport" className="w-full max-w-xl mx-auto glass-panel border border-[#2d4f2d]/40 rounded-xl p-6 sm:p-10 text-center relative shadow-2xl shadow-black animate-fade-in">
              {/* Visual Glass isolation tank enclosing the newborn lichen */}
              <div className="w-56 h-56 rounded-full border border-[#2d4f2d]/40 bg-black/60 relative flex items-center justify-center p-3 mb-8 mx-auto glow-amber">
                {/* Glass shine arches */}
                <div className="absolute top-[4%] left-[10%] right-[10%] h-[2px] bg-gradient-to-r from-transparent via-[#d4d4c8]/25 to-transparent rounded-full pointer-events-none" />
                <div className="absolute inset-5 border border-[#2d4f2d]/10 rounded-full" />
                <div className="w-full h-full overflow-hidden rounded-full flex items-center justify-center">
                  <LichenRenderer organism={newlyGerminated} isDetailed={true} />
                </div>
              </div>

              <span className="font-sans text-[9px] tracking-[0.25em] text-[#ffbf00] uppercase font-semibold">
                Emergent Organism Fused Successfully
              </span>

              <h3 className="font-serif text-3xl sm:text-4xl text-[#d4d4c8] font-light italic tracking-wide mt-2">
                {newlyGerminated.name}
              </h3>
              
              <p className="font-sans text-[10px] text-[#8ba18b] tracking-widest uppercase mt-1">
                Morphology: {newlyGerminated.structure} Thallus
              </p>

              <p className="font-serif italic text-sm text-[#d4d4c8]/80 gap-1 max-w-sm mt-5 mb-8 mx-auto leading-relaxed">
                "Your final exhalation locked the neural structure. It takes its first breath inside the carbon sphere."
              </p>

              <button
                id="reveal_cabinet_chamber_btn"
                onClick={handleTransitionToVault}
                className="w-full max-w-xs border border-[#ffbf00]/30 py-4 px-6 text-[11px] uppercase tracking-[0.3em] text-[#ffbf00] hover:bg-[#ffbf00]/5 hover:border-[#ffbf00]/50 transition-colors duration-300 cursor-pointer flex items-center justify-center gap-2 mx-auto relative overflow-hidden select-none"
              >
                <Eye className="w-4 h-4" />
                <span className="relative z-10 font-sans">Retreat to Isolation Chamber</span>
              </button>
            </div>
          )}

          {view === "vault" && (
            // ================= STEP 5 & 6: VAULT ARCHIVE & DETAILED SPECS CABINET =================
            <div className="w-full relative z-10">
              <VaultCabinet
                organisms={organisms}
                onBackToLanding={() => setView("landing")}
                onUpdateOrganism={handleUpdateOrganismInVault}
              />
            </div>
          )}
        </>
      )}

    </main>

        {/* FOOTER: Static Observatory Metadata */}
        <footer className="max-w-6xl mx-auto w-full flex flex-col sm:flex-row items-center justify-between text-center sm:text-left font-sans text-[8px] tracking-[0.2em] text-[#8ba18b]/60 border-t border-[#2d4f2d]/30 pt-4 gap-2 z-10 select-none">
          <div>
            THE LICHEN VAULT PROT-ID: 9a423d78-3dfe-43bb-9a15-964f84e46aeb
          </div>
          <div>
            AUTHENTIC INTERACTION CABINET // NO DIGITAL COPIERS
          </div>
          <div>
            ARCHIVE TIME: LOCAL BROWSER RECORD
          </div>
        </footer>
      </div>
    </div>
  );
}
