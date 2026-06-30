import React, { useState, useEffect } from "react";
import { BookOpen, Calendar, Hourglass, ChevronLeft, RefreshCw, Layers, Sparkles, GitBranch, ShieldCheck, Eye, Download, X } from "lucide-react";
import { LichenOrganism, ArchivalObservation } from "../types";
import { calculateGrowthState, SeededRandom } from "../utils/generator";
import { LichenRenderer } from "./LichenRenderer";
import { EvidenceRecord, InterventionProposal, SpecimenEvent, TraceEvent } from "../domain";
import { ArchivistResponseSchema, localArchivistFallback, toObservation } from "../application/archivist";
import { DecisionKind } from "../application/policy";
import {
  createVaultUiExportPayload,
  evidenceIdsForTrace,
  groupTracesByWorkflow,
  inspectEvidenceReference,
  proposalDisplayState,
  traceStatusLabel
} from "./vaultInspection";

interface VaultCabinetProps {
  organisms: LichenOrganism[];
  onBackToLanding: () => void;
  onUpdateOrganism: (updated: LichenOrganism) => void;
  onLoadTraces: (specimenId: string) => Promise<TraceEvent[]>;
  onLoadEvidence: (specimenId: string) => Promise<EvidenceRecord[]>;
  onLoadProposals: (specimenId: string) => Promise<InterventionProposal[]>;
  onLoadEvents: (specimenId: string) => Promise<SpecimenEvent[]>;
  onDecideProposal: (proposalId: string, decision: DecisionKind) => Promise<void>;
}

export const VaultCabinet: React.FC<VaultCabinetProps> = ({
  organisms,
  onBackToLanding,
  onUpdateOrganism,
  onLoadTraces,
  onLoadEvidence,
  onLoadProposals,
  onLoadEvents,
  onDecideProposal,
}) => {
  const [selectedLichen, setSelectedLichen] = useState<LichenOrganism | null>(null);
  const [isGeneratingMemory, setIsGeneratingMemory] = useState<boolean>(false);
  const [currentAgeStr, setCurrentAgeStr] = useState<string>("");
  const [currentStageLabel, setCurrentStageLabel] = useState<string>("");
  const [viewingMode, setViewingMode] = useState<"containment" | "deposit">("containment");
  const [tracePanelOpen, setTracePanelOpen] = useState<boolean>(true);
  const [traces, setTraces] = useState<TraceEvent[]>([]);
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [proposals, setProposals] = useState<InterventionProposal[]>([]);
  const [proposalBusyId, setProposalBusyId] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [exportBusyId, setExportBusyId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // Helper to establish a consistent fictional "Vault Hall" location based on its seed
  const getVaultHall = (seed: number): string => {
    const halls = [
      "Hall of Whispering Volatiles, Shelf 14",
      "Sovereign Crypt, Alcove IX",
      "Forgotten digital archive, Compartment XII",
      "Monastery Cloister, Niche VII",
      "Eastern Herbarium, Drawer 03",
      "Abyssal Conservatory, Tier IV"
    ];
    return halls[seed % halls.length];
  };

  // Helper to get fictional custodian notes
  const getCustodianNotes = (seed: number): string => {
    const notes = [
      "Catalogued inside simulation cylinder #107. Avoid treating the chamber labels as physical preservation instructions.",
      "Sealed under silica glass at 3.4 Pascals. Exhibits subtle expansion reactions to copper near-frequencies. Keep protective dark shutters closed.",
      "Rendered against a basalt-like procedural substrate. Motion and age labels are deterministic display states, not biological respiration.",
      "Grown in clean quartz atmosphere. Custodian recommends comparing photographic plates during sequential solstice intervals.",
    ];
    return notes[seed % notes.length];
  };

  // Helper to map age to a mystery specimen status
  const getSpecimenStatus = (birthTime: number): string => {
    const ageMs = Date.now() - birthTime;
    if (ageMs < 45000) return "Newly catalogued // Metrics settling";
    if (ageMs < 300000) return "Procedural branching established // Local record complete";
    return "Quiet display state // Deep time simulation active";
  };

  // Deterministic initial observations so we can show historical book timeline on launch
  const generateInitialObservations = (seed: number, birthTime: number): ArchivalObservation[] => {
    const rand = new SeededRandom(seed);
    const obsGroup1 = [
      "Derived breath metrics were recorded immediately after the deposition ritual. The digital dome settled into its first display state.",
      "The initial cadence was written into the local ledger. Procedural structure shows high visual density.",
      "The fictional breath trace crossed the gate. The rendered core remains in concentric balance."
    ];
    const obsGroup2 = [
      "A faint expansion has been registered near the lower edge of the thallus. No environmental fluctuations detected inside containment.",
      "The embryonic thallus appears to have anchored securely onto the porous rock medium. Faint gold luminescence is present in darkness.",
      "Observations show a quiet simulated state. The thallus display has shifted slightly, branching according to a deterministic sequence."
    ];
    
    return [
      {
        id: `obs_${birthTime}_1`,
        timestamp: birthTime,
        observationNumber: 1,
        text: rand.pick(obsGroup1),
        evidenceIds: [],
        confidence: null,
        generatedBy: "local_fallback",
        verificationStatus: "fallback"
      },
      {
        id: `obs_${birthTime}_2`,
        timestamp: birthTime + 120000, // 2 minutes later
        observationNumber: 2,
        text: rand.pick(obsGroup2),
        evidenceIds: [],
        confidence: null,
        generatedBy: "local_fallback",
        verificationStatus: "fallback"
      }
    ];
  };

  // Tick chronological age of the selected lichen to show deep time growth
  useEffect(() => {
    if (!selectedLichen) return;

    const tickAge = () => {
      const ageMs = Date.now() - selectedLichen.birthTime;
      const totalSec = Math.floor(ageMs / 1000);
      
      const days = Math.floor(totalSec / 86400);
      const hours = Math.floor((totalSec % 86400) / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;

      let ageStr = "";
      if (days > 0) ageStr += `${days} days `;
      if (hours > 0 || days > 0) ageStr += `${hours}h `;
      if (mins > 0 || hours > 0 || days > 0) ageStr += `${mins}m `;
      ageStr += `${secs}s`;

      setCurrentAgeStr(ageStr);

      const growth = calculateGrowthState(selectedLichen.birthTime);
      setCurrentStageLabel(growth.stageLabel);
    };

    tickAge();
    const interval = setInterval(tickAge, 1000);
    return () => clearInterval(interval);
  }, [selectedLichen]);

  // Handle setting up initial observations if none exist for a loaded organism
  useEffect(() => {
    if (selectedLichen && (!selectedLichen.observations || selectedLichen.observations.length === 0)) {
      const initialLogs = generateInitialObservations(selectedLichen.seed, selectedLichen.birthTime);
      const updated: LichenOrganism = {
        ...selectedLichen,
        observations: initialLogs,
      };
      onUpdateOrganism(updated);
      setSelectedLichen(updated);
    }
  }, [selectedLichen]);

  useEffect(() => {
    if (!selectedLichen) {
      setTraces([]);
      setEvidence([]);
      setProposals([]);
      setSelectedEvidenceId(null);
      setProposalError(null);
      setExportStatus(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      onLoadTraces(selectedLichen.id),
      onLoadEvidence(selectedLichen.id),
      onLoadProposals(selectedLichen.id)
    ]).then(([nextTraces, nextEvidence, nextProposals]) => {
      if (cancelled) return;
      setTraces(nextTraces);
      setEvidence(nextEvidence);
      setProposals(nextProposals);
    }).catch((error) => {
      console.error("Failed to load specimen trace data:", error);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedLichen]);

  // Request a fresh, calm observation log entry from the invisible Archivist narrator
  const drawNewArchivistObservation = async (lichenToUpdate: LichenOrganism) => {
    if (isGeneratingMemory) return;
    setIsGeneratingMemory(true);

    try {
      const currentEvidence = evidence.length > 0 ? evidence : await onLoadEvidence(lichenToUpdate.id);
      if (currentEvidence.length === 0) {
        throw new Error("No persisted evidence is available for a grounded observation.");
      }
      const growth = calculateGrowthState(lichenToUpdate.birthTime);
      const res = await fetch("/api/archivist/observe", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           workflowId: `wf_manual_${Date.now()}`,
           specimen: {
             id: lichenToUpdate.id,
             name: lichenToUpdate.name,
             structure: lichenToUpdate.structure,
             stageLabel: currentStageLabel || growth.stageLabel,
           },
           evidence: currentEvidence.map((item) => ({
             id: item.id,
             sourceType: item.sourceType,
             timestamp: item.timestamp,
             payload: item.payload
           })),
         }),
      });

      if (!res.ok) throw new Error("Whisper matrix failed");
      const data = ArchivistResponseSchema.parse(await res.json());
      
      const currentLogs = lichenToUpdate.observations || [];
      const nextNum = currentLogs.length + 1;
      const newObs = toObservation({
        response: data,
        observationNumber: nextNum,
        timestamp: Date.now(),
        evidence: currentEvidence
      });

      const updatedLichen: LichenOrganism = {
        ...lichenToUpdate,
        observations: [...currentLogs, newObs],
      };

      onUpdateOrganism(updatedLichen);
      setSelectedLichen(updatedLichen);
    } catch (err) {
      console.error("Failed to generate archivist observation:", err);
      const currentLogs = lichenToUpdate.observations || [];
      const nextNum = currentLogs.length + 1;
      const fallback = localArchivistFallback({
        specimenName: lichenToUpdate.name,
        stageLabel: currentStageLabel || "contained thallus",
        reason: err instanceof Error ? err.message : "archivist_failed"
      });
      const newObs: ArchivalObservation = toObservation({
        response: fallback,
        observationNumber: nextNum,
        timestamp: Date.now(),
        evidence: []
      });
      const updatedLichen: LichenOrganism = {
        ...lichenToUpdate,
        observations: [...currentLogs, newObs],
      };
      onUpdateOrganism(updatedLichen);
      setSelectedLichen(updatedLichen);
    } finally {
      setIsGeneratingMemory(false);
    }
  };

  const decide = async (proposalId: string, decision: DecisionKind) => {
    if (!selectedLichen || proposalBusyId) return;
    setProposalError(null);
    setProposalBusyId(proposalId);
    try {
      await onDecideProposal(proposalId, decision);
      const [nextProposals, nextTraces] = await Promise.all([
        onLoadProposals(selectedLichen.id),
        onLoadTraces(selectedLichen.id)
      ]);
      setProposals(nextProposals);
      setTraces(nextTraces);
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : "Decision could not be recorded.");
    } finally {
      setProposalBusyId(null);
    }
  };

  const openEvidence = (evidenceId: string) => {
    setSelectedEvidenceId(evidenceId);
  };

  const exportApprovedProposal = async (proposal: InterventionProposal) => {
    if (!selectedLichen || exportBusyId) return;
    const confirmed = window.confirm(
      "Prepare a versioned Lichen Vault JSON export?\n\nIncluded: specimen profile, event log, structured evidence, traces, and proposal decisions.\n\nExcluded: raw audio, API keys, approval tokens, secrets, and raw model prompts."
    );
    if (!confirmed) return;

    setExportBusyId(proposal.id);
    setExportStatus(null);
    try {
      const [nextEvents, nextEvidence, nextTraces, nextProposals] = await Promise.all([
        onLoadEvents(selectedLichen.id),
        onLoadEvidence(selectedLichen.id),
        onLoadTraces(selectedLichen.id),
        onLoadProposals(selectedLichen.id)
      ]);
      const exported = createVaultUiExportPayload({
        specimen: selectedLichen,
        events: nextEvents,
        evidence: nextEvidence,
        traces: nextTraces,
        proposals: nextProposals,
        exportedAt: new Date().toISOString()
      });
      setEvidence(nextEvidence);
      setTraces(nextTraces);
      setProposals(nextProposals);

      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selectedLichen.id}-vault-export-v${exported.schemaVersion}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setExportStatus(`Export prepared with ${exported.evidence.length} evidence records and ${exported.traces.length} traces.`);
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "Export could not be prepared.");
    } finally {
      setExportBusyId(null);
    }
  };

  const handleSelectLichen = (lichen: LichenOrganism) => {
    setSelectedLichen(lichen);
    setViewingMode("containment");
  };

  const handleDeselect = () => {
    setSelectedLichen(null);
    setCurrentAgeStr("");
  };

  const formatDate = (ms: number): string => {
    const d = new Date(ms);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const traceGroups = groupTracesByWorkflow(traces);
  const evidenceInspection = selectedEvidenceId
    ? inspectEvidenceReference(evidence, selectedEvidenceId, traces, proposals)
    : null;

  return (
    <div id="vault_master_editorial" className="w-full min-h-[500px]">
      {!selectedLichen ? (
        // STATE A: THE VAULT GRID (CABINET CABINETS Drawer)
        <div className="animate-fade-in">
          <div className="flex flex-col sm:flex-row items-center justify-between mb-8 pb-4 border-b border-[#2d4f2d]/30 gap-4">
            <div className="text-center sm:text-left font-serif">
              <h2 className="text-2xl text-[#d4d4c8] tracking-widest font-light flex items-center justify-center sm:justify-start gap-2 uppercase">
                <BookOpen className="w-5 h-5 text-[#8ba18b]" />
                SPECIMEN CATALOGUE // SEC-08
              </h2>
              <p className="italic text-xs text-[#8ba18b] mt-1">
                A total of {organisms.length} fictional digital specimens catalogued in this browser.
              </p>
            </div>
            <button
              id="cabinet_back_landing_btn"
              onClick={onBackToLanding}
              className="px-6 py-2 rounded-sm border border-[#ffbf00]/20 font-mono text-[10px] uppercase tracking-[0.25em] text-[#d4d4c8] hover:text-[#ffbf00] hover:border-[#ffbf00]/50 transition-all cursor-pointer bg-transparent"
            >
              ← EXHALATION CHAMBER
            </button>
          </div>

          {organisms.length === 0 ? (
            // No organisms deposited yet
            <div className="glass-panel text-center p-12 max-w-md mx-auto my-12 border border-[#2d4f2d]/30">
              <p className="font-serif italic text-lg text-[#ffbf00]/80">
                "The ledger stands empty. No breath-derived digital specimen has crossed this threshold."
              </p>
              <p className="text-xs text-[#8ba18b] font-sans mt-4 leading-relaxed">
                Return to the entrance portal and perform the threefold breath deposit ritual to generate your first procedural digital specimen.
              </p>
              <button
                id="empty_vault_begin_btn"
                onClick={onBackToLanding}
                className="mt-6 w-full border border-[#ffbf00]/30 py-3 px-6 text-[11px] uppercase tracking-[0.3em] hover:bg-[#ffbf00]/5 transition-colors duration-300 relative overflow-hidden text-[#ffbf00] cursor-pointer bg-transparent"
              >
                Initiate Digital Deposition
              </button>
            </div>
          ) : (
            // Grid cabinet drawer
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {organisms.map((org) => {
                const growth = calculateGrowthState(org.birthTime);
                return (
                  <div
                    key={org.id}
                    id={`cabinet_card_${org.id}`}
                    onClick={() => handleSelectLichen(org)}
                    className="group glass-panel p-5 cursor-pointer hover:border-[#ffbf00]/30 transition-all duration-300 relative overflow-hidden flex flex-col justify-between border border-[#2d4f2d]/20 h-96 shadow-lg shadow-black/60 hover:shadow-[#ffbf00]/5 rounded-xl"
                  >
                    {/* Tiny spore particles background */}
                    <div className="absolute inset-0 bg-radial-gradient from-emerald-950/5 via-transparent to-transparent pointer-events-none" />

                    {/* Miniature glass sphere display */}
                    <div className="w-full h-44 rounded-full border border-[#2d4f2d]/15 bg-black/40 glow-green relative flex items-center justify-center p-2 mb-4 group-hover:border-[#ffbf00]/30 transition-all duration-300">
                      {/* Glass glare effect lines */}
                      <div className="absolute top-2 left-6 right-6 h-[1.5px] bg-gradient-to-r from-transparent via-[#8ba18b]/15 to-transparent rounded-full" />
                      <div className="w-11/12 h-11/12 overflow-hidden rounded-full flex items-center justify-center">
                        <LichenRenderer organism={org} isDetailed={false} />
                      </div>
                    </div>

                    {/* Metadata specs */}
                    <div>
                      <div className="flex justify-between items-start">
                        <h3 className="font-serif text-lg text-[#d4d4c8] group-hover:text-[#ffbf00] transition-colors tracking-wide font-medium italic">
                          {org.name}
                        </h3>
                        <span className="font-sans text-[9px] text-[#8ba18b] tracking-wider uppercase">
                          {org.structure}
                        </span>
                      </div>

                      <div className="font-sans text-[9px] text-[#8ba18b]/70 tracking-wider mt-1.5 flex flex-col gap-1 border-t border-[#2d4f2d]/20 pt-2">
                        <div className="flex justify-between">
                          <span>GERMINATION:</span>
                          <span className="text-[#d4d4c8]">{formatDate(org.birthTime)}</span>
                        </div>
                        <div className="flex justify-between text-[#8ba18b]/50">
                          <span>STAGE:</span>
                          <span className="text-[#ffbf00] font-serif italic text-xs">{growth.stageLabel}</span>
                        </div>
                        <div className="flex justify-between text-[#8ba18b]/50">
                          <span>STATUS:</span>
                          <span className="text-[#d4d4c8] uppercase tracking-wider font-light text-[8px]">Containment Stable</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        // STATE B: PRIMARY ISOLATION CHAMBER (CLOSE INSPECTION VIEW WITH ORIGINAL PHOTO COMPARISON)
        <div className="animate-fade-in grid grid-cols-1 lg:grid-cols-12 gap-8 font-serif">
          
          {/* Header row to return */}
          <div className="col-span-12 flex items-center justify-between pb-4 border-b border-[#2d4f2d]/30">
            <button
              id="inspection_chamber_back_btn"
              onClick={handleDeselect}
              className="flex items-center gap-1.5 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[#8ba18b] hover:text-[#ffbf00] transition-colors border border-[#2d4f2d]/35 hover:border-[#ffbf00]/40 rounded-sm cursor-pointer bg-transparent"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              ← RETURN TO SPECIMEN INDEX
            </button>
            <div className="font-sans text-[10px] tracking-widest text-[#8ba18b] uppercase font-light">
              CONTAINMENT SECTOR // SPECIMEN_{selectedLichen.id.slice(-8).toUpperCase()}
            </div>
          </div>

          {/* Left Column: Isolation Cylinder containing specimen and toggle */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            
            {/* Cylinder Dome wrapper */}
            <div className="w-full aspect-square md:max-w-md mx-auto rounded-full border border-[#d4d4c8]/10 bg-white/5 backdrop-blur-sm p-4 relative flex items-center justify-center glow-amber shadow-[inset_0_0_80px_rgba(255,191,0,0.05)] overflow-hidden">
              <div className="absolute inset-2 border border-[#2d4f2d]/20 rounded-full pointer-events-none" />
              <div className="absolute inset-4 border border-[#ffbf00]/5 rounded-full pointer-events-none" />
              <div className="absolute inset-0 border-[3px] border-[#2d4f2d]/10 rounded-full pointer-events-none animate-spin-slow animate-pulse" />

              <div className="absolute top-[15%] left-[20%] w-32 h-16 bg-white/5 rounded-full blur-md -rotate-44 pointer-events-none"></div>

              <div className="w-full h-full overflow-hidden rounded-full flex items-center justify-center">
                <LichenRenderer 
                  organism={selectedLichen} 
                  isDetailed={true} 
                  isInitialDeposit={viewingMode === "deposit"} 
                />
              </div>
              
              {/* Overlay Label indicating active mode */}
              <div className="absolute bottom-6 bg-black/80 px-3 py-1 border border-[#ffbf00]/25 rounded text-center select-none shadow">
                <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#ffbf00]">
                  {viewingMode === "containment" ? "CELL RADIAL SCOPE" : "GERMINATION SEED LABPLATE"}
                </p>
              </div>
            </div>

            {/* Scientific slider tab options for comparison visualization */}
            <div className="flex border border-[#2d4f2d]/40 rounded-sm overflow-hidden p-0.5 bg-black/60 max-w-sm w-full mx-auto shadow-inner">
              <button
                onClick={() => setViewingMode("containment")}
                className={`flex-1 py-2 text-[9px] uppercase tracking-[0.2em] font-sans transition-all duration-200 cursor-pointer ${
                  viewingMode === "containment"
                    ? "bg-[#ffbf00]/10 text-[#ffbf00] border border-[#ffbf00]/20 font-semibold"
                    : "text-[#8ba18b]/60 hover:text-[#d4d4c8]"
                }`}
              >
                Physical Containment View
              </button>
              <button
                onClick={() => setViewingMode("deposit")}
                className={`flex-1 py-2 text-[9px] uppercase tracking-[0.2em] font-sans transition-all duration-200 cursor-pointer ${
                  viewingMode === "deposit"
                    ? "bg-[#ffbf00]/10 text-[#ffbf00] border border-[#ffbf00]/20 font-semibold"
                    : "text-[#8ba18b]/60 hover:text-[#d4d4c8]"
                }`}
              >
                Deposit Plate Record
              </button>
            </div>

            {/* Atmosphere readings (mystery focus, non-telemetry) */}
            <div className="glass-panel p-4 max-w-md mx-auto w-full border border-[#2d4f2d]/30 flex flex-col gap-2 rounded-lg">
              <div className="flex justify-between items-center text-xs font-sans">
                <span className="text-[#8ba18b]/60 uppercase tracking-widest text-[9px]">CHAMBER HUMIDITY MATRIX</span>
                <span className="text-[#ffbf00] uppercase tracking-wider font-light text-[10px]">Optimal Suspension</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-mono mt-1 text-[#8ba18b]/50 border-t border-[#2d4f2d]/25 pt-2">
                <span>VACUUM PRESSURE SEALS: CONSTANT</span>
                <span>HYPHAE DISCHARGE: INERT</span>
              </div>
            </div>
            
            {/* Contemplative notice of Temporal Distance */}
            <div className="p-4 border border-[#2d4f2d]/25 bg-[#050805]/80 text-[#8ba18b]/80 rounded text-[11px] leading-relaxed italic max-w-md mx-auto text-center font-serif">
              "This specimen requires temporal distance. The quartz chamber is fictional; display changes respond to deterministic time calculations. Return in future months to compare simulated alterations of the thallus."
            </div>

          </div>

          {/* Right Column: Museum Archival Cabinet records ledger */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            
            {/* Specimen Ledger Sheet */}
            <div className="glass-panel p-6 border border-[#2d4f2d]/30 relative rounded-xl bg-[#060a06]/40">
              <div className="absolute top-3 right-4 font-serif text-[42px] leading-none opacity-5 italic text-[#8ba18b] select-none font-light uppercase">
                {selectedLichen.structure}
              </div>

              <div className="font-mono text-[9px] text-[#ffbf00] tracking-[0.2em] uppercase mb-1">
                ARCHIVAL ACCESSION ID // {selectedLichen.id.slice(-8).toUpperCase()}
              </div>

              <h3 className="font-serif text-3xl text-[#ffbf00]/90 italic tracking-wide font-light">
                {selectedLichen.name}
              </h3>
              <p className="font-serif italic text-xs text-[#8ba18b] mt-1">
                Fictional digital thallus grown from local breath duration, intensity, and cadence metrics.
              </p>

              {/* Archival category listings (dashboard sections replaced with museum records) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 border-t border-[#2d4f2d]/30 pt-5">
                
                <div className="flex items-start gap-2.5">
                  <Calendar className="w-4 h-4 text-[#8ba18b]/70 mt-0.5" />
                  <div className="font-sans text-xs">
                    <div className="text-[9px] uppercase tracking-widest text-[#8ba18b]/60 font-medium">Deposit Date</div>
                    <div className="text-[#d4d4c8] font-medium mt-0.5">{formatDate(selectedLichen.birthTime)}</div>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Hourglass className="w-4 h-4 text-[#ffbf00]/70 mt-0.5 animate-pulse" />
                  <div className="font-sans text-xs">
                    <div className="text-[9px] uppercase tracking-widest text-[#8ba18b]/60 font-medium">Accumulated Time-Age</div>
                    <div className="text-[#d4d4c8] font-medium mt-0.5">{currentAgeStr || "Evolving..."}</div>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Layers className="w-4 h-4 text-[#8ba18b]/70 mt-0.5" />
                  <div className="font-sans text-xs">
                    <div className="text-[9px] uppercase tracking-widest text-[#8ba18b]/60 font-medium">Botanical Taxon Stage</div>
                    <div className="text-[#ffbf00] font-serif italic text-xs mt-0.5">{currentStageLabel || "Evolving..."}</div>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <BookOpen className="w-4 h-4 text-[#8ba18b]/70 mt-0.5" />
                  <div className="font-sans text-xs">
                    <div className="text-[9px] uppercase tracking-widest text-[#8ba18b]/60 font-medium">Vault Hall</div>
                    <div className="text-[#d4d4c8] font-medium mt-0.5">{getVaultHall(selectedLichen.seed)}</div>
                  </div>
                </div>

                <div className="col-span-1 md:col-span-2 flex items-start gap-2.5 border-t border-[#2d4f2d]/20 pt-3 mt-1">
                  <div className="font-sans text-xs w-full">
                    <div className="text-[9px] uppercase tracking-widest text-[#8ba18b]/60 font-medium flex justify-between items-center">
                      <span>Specimen Status</span>
                      <span className="w-2 h-2 rounded-full bg-[#ffbf00] animate-ping" />
                    </div>
                    <div className="text-[#ffbf00]/90 font-serif italic text-[11px] mt-1">{getSpecimenStatus(selectedLichen.birthTime)}</div>
                  </div>
                </div>

              </div>

              {/* Custodian Notes section (Replaces procedural telemetry metrics) */}
              <div className="bg-[#050805]/70 border border-[#2d4f2d]/25 rounded p-4 mt-6">
                <h4 className="font-sans text-[10px] tracking-widest text-[#ffbf00]/70 uppercase mb-2">
                  Custodian Notes // Log Section
                </h4>
                <p className="font-serif italic text-xs text-[#8ba18b] leading-relaxed">
                  {getCustodianNotes(selectedLichen.seed)}
                </p>
              </div>

            </div>

            {/* ARCHIVE JOURNAL SECTION */}
            <div className="glass-panel p-6 border border-[#2d4f2d]/30 flex-1 flex flex-col justify-between rounded-xl">
              
              <div>
                <div className="flex items-center justify-between mb-4 border-b border-[#2d4f2d]/30 pb-3">
                  <h4 className="font-serif text-[#d4d4c8] tracking-[0.08em] font-light flex items-center gap-2 uppercase">
                    <Sparkles className="w-4 h-4 text-[#ffbf00] animate-pulse" />
                    Archive Journal // Custodian Observations
                  </h4>
                  <span className="font-sans text-[8px] tracking-[0.2em] text-[#8ba18b]/60 uppercase">CHRONOLOGICAL EXAMINATIONS</span>
                </div>

                {isGeneratingMemory && (!selectedLichen.observations || selectedLichen.observations.length === 0) ? (
                  /* Loading Matrix */
                  <div className="flex flex-col items-center justify-center py-10">
                    <RefreshCw className="w-8 h-8 text-[#ffbf00] animate-spin mb-3" />
                    <p className="font-mono text-[10px] text-[#ffbf00]/80 tracking-widest animate-pulse uppercase">
                      Writing a grounded Archivist note from persisted evidence...
                    </p>
                    <p className="font-serif italic text-[11px] text-[#8ba18b]/50 mt-1 max-w-xs text-center leading-relaxed">
                      Checking evidence references and fallback rules...
                    </p>
                  </div>
                ) : !selectedLichen.observations || selectedLichen.observations.length === 0 ? (
                  /* Empty state */
                  <p className="font-serif italic text-sm text-[#8ba18b]/50 text-center py-8">
                    No logs have been recorded in this ledger yet.
                  </p>
                ) : (
                  /* Chronicled notebook logs from the invisible Archivist */
                  <div className="flex flex-col gap-4 max-h-80 overflow-y-auto pr-2 scrollbar-thin">
                    {[...selectedLichen.observations].reverse().map((obs) => (
                      <div
                        key={obs.id}
                        className={`p-4 rounded border relative bg-[#050805]/75 border-[#2d4f2d]/35 font-serif`}
                      >
                        <div className="flex justify-between items-center text-sans text-[8px] text-[#8ba18b]/60 mb-2 uppercase tracking-wider">
                          <span>Observation Entry #{obs.observationNumber.toString().padStart(2, "0")}</span>
                          <span>Timestamp: {formatDate(obs.timestamp)}</span>
                        </div>
                        
                        <p className="text-[13px] leading-relaxed text-[#d4d4c8]/95 font-serif">
                          {obs.text}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Request fresh journal log from the Archivist */}
              <div className="mt-6 pt-4 border-t border-[#2d4f2d]/20 flex items-center justify-between gap-4">
                <button
                  id="evoke_specimen_memory_btn"
                  onClick={() => drawNewArchivistObservation(selectedLichen)}
                  disabled={isGeneratingMemory}
                  className="w-full border border-[#ffbf00]/30 py-4 px-6 text-[11px] uppercase tracking-[0.3em] text-[#ffbf00] hover:bg-[#ffbf00]/5 hover:border-[#ffbf00]/50 transition-colors duration-300 group relative overflow-hidden disabled:opacity-40 select-none cursor-pointer bg-transparent"
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {isGeneratingMemory && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    {isGeneratingMemory ? "Writing Observation note..." : "Request Archivist Observation Note"}
                  </span>
                  <div className="absolute inset-0 bg-[#ffbf00]/5 translate-y-full group-hover:translate-y-0 transition-transform duration-500 font-sans"></div>
                </button>
              </div>

            </div>

            {/* TRACE PANEL */}
            <div className="glass-panel p-5 border border-[#2d4f2d]/30 rounded-xl bg-[#050805]/70">
              <button
                type="button"
                onClick={() => setTracePanelOpen((open) => !open)}
                aria-expanded={tracePanelOpen}
                className="w-full flex items-center justify-between text-left bg-transparent cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ffbf00]/70"
              >
                <span className="font-serif text-[#d4d4c8] tracking-[0.08em] font-light flex items-center gap-2 uppercase">
                  <GitBranch className="w-4 h-4 text-[#ffbf00]" />
                  Workflow Trace
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#8ba18b]">
                  {tracePanelOpen ? "Collapse" : "Expand"} // {traces.length}
                </span>
              </button>
              {tracePanelOpen && (
                <div className="mt-4 flex flex-col gap-3 max-h-72 overflow-y-auto pr-1">
                  {traces.length === 0 ? (
                    <p className="font-serif italic text-xs text-[#8ba18b]/60">No workflow trace has been persisted for this historical specimen.</p>
                  ) : traceGroups.map((group) => (
                    <div key={group.workflowId} className="border border-[#2d4f2d]/20 bg-black/20 rounded p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-[#8ba18b]/70 break-all">
                          Workflow {group.workflowId}
                        </span>
                        <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-[#8ba18b]/50">
                          {new Date(group.latestTimestamp).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {group.traces.map((item) => (
                          <div key={item.id} className="border border-[#2d4f2d]/25 bg-[#050805]/60 rounded p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.16em]">
                              <span className="text-[#ffbf00]">{item.operation}</span>
                              <span className={item.status === "failed" ? "text-red-400" : item.status === "fallback" ? "text-[#ffbf00]" : "text-[#8ba18b]"}>
                                {item.actor} // {traceStatusLabel(item)} // {item.durationMs ?? 0} ms
                              </span>
                            </div>
                            <div className="mt-1 font-mono text-[8px] uppercase tracking-[0.16em] text-[#8ba18b]/55">
                              {new Date(item.timestamp).toLocaleString()}
                            </div>
                            <p className="font-serif text-xs text-[#d4d4c8]/85 mt-2 leading-relaxed">{item.summary}</p>
                            {(item.fallbackReason || item.errorCode) && (
                              <p role={item.status === "failed" ? "alert" : "status"} className="font-mono text-[9px] text-[#ffbf00]/75 mt-2">
                                {item.fallbackReason ?? item.errorCode}
                              </p>
                            )}
                            {evidenceIdsForTrace(item).length > 0 && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#8ba18b]/60">Evidence</span>
                                {evidenceIdsForTrace(item).map((evidenceId) => (
                                  <button
                                    key={`${item.id}_${evidenceId}`}
                                    type="button"
                                    onClick={() => openEvidence(evidenceId)}
                                    className="border border-[#2d4f2d]/40 px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#d4d4c8]/75 hover:border-[#ffbf00]/50 hover:text-[#ffbf00] bg-black/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ffbf00]/70"
                                  >
                                    {evidenceId}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* EVIDENCE VIEWER */}
            {evidenceInspection && (
              <div className="glass-panel p-5 border border-[#2d4f2d]/30 rounded-xl bg-[#050805]/70">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <h4 className="font-serif text-[#d4d4c8] tracking-[0.08em] font-light flex items-center gap-2 uppercase">
                      <Eye className="w-4 h-4 text-[#ffbf00]" />
                      Evidence Viewer
                    </h4>
                    <p className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#8ba18b]/60 mt-1 break-all">
                      {evidenceInspection.id}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close evidence viewer"
                    onClick={() => setSelectedEvidenceId(null)}
                    className="border border-[#2d4f2d]/40 p-1.5 text-[#8ba18b] hover:text-[#ffbf00] hover:border-[#ffbf00]/50 bg-transparent focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ffbf00]/70"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {!evidenceInspection.found ? (
                  <p role="status" className="font-serif italic text-xs text-[#ffbf00]/80">
                    This evidence reference is persisted in a trace or proposal, but the evidence record is missing from storage.
                  </p>
                ) : (
                  <div className="grid gap-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#8ba18b]/75">
                      <span>Source // {evidenceInspection.evidence.sourceType}</span>
                      <span>Schema // v{evidenceInspection.evidence.schemaVersion}</span>
                      <span>Timestamp // {new Date(evidenceInspection.evidence.timestamp).toLocaleString()}</span>
                      <span>Event // {evidenceInspection.evidence.sourceEventId ?? "none"}</span>
                      <span>Workflows // {evidenceInspection.relatedWorkflowIds.join(", ") || "none"}</span>
                      <span>Grounding // {evidenceInspection.groundingLabel}</span>
                    </div>
                    <pre className="max-h-48 overflow-auto rounded border border-[#2d4f2d]/20 bg-black/30 p-3 text-[10px] leading-relaxed text-[#d4d4c8]/80 whitespace-pre-wrap break-words">
                      {JSON.stringify(evidenceInspection.payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* HUMAN APPROVAL PANEL */}
            <div className="glass-panel p-5 border border-[#2d4f2d]/30 rounded-xl bg-[#050805]/70">
              <h4 className="font-serif text-[#d4d4c8] tracking-[0.08em] font-light flex items-center gap-2 uppercase mb-4">
                <ShieldCheck className="w-4 h-4 text-[#ffbf00]" />
                Human Approval
              </h4>
              {proposalError && (
                <p role="alert" className="mb-3 border border-red-900/40 bg-red-950/20 p-3 font-serif text-xs text-red-200">
                  {proposalError}
                </p>
              )}
              {exportStatus && (
                <p role="status" className="mb-3 border border-[#2d4f2d]/30 bg-black/20 p-3 font-serif text-xs text-[#8ba18b]">
                  {exportStatus}
                </p>
              )}
              {proposals.length === 0 ? (
                <p className="font-serif italic text-xs text-[#8ba18b]/60">No intervention proposals are pending in this chamber.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {[...proposals].reverse().map((proposal) => {
                    const display = proposalDisplayState(proposal, proposalBusyId);
                    return (
                      <div key={proposal.id} className="border border-[#2d4f2d]/25 bg-black/25 rounded p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#ffbf00]">
                              {proposal.action} // {display.riskLabel}
                            </div>
                            <p className="font-serif text-xs text-[#d4d4c8]/85 mt-2 leading-relaxed">{proposal.reason}</p>
                          </div>
                          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8ba18b]">{display.statusLabel}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#8ba18b]/60">Evidence</span>
                          {proposal.evidenceIds.length === 0 ? (
                            <span className="font-mono text-[8px] text-[#8ba18b]/50">none</span>
                          ) : proposal.evidenceIds.map((evidenceId) => (
                            <button
                              key={`${proposal.id}_${evidenceId}`}
                              type="button"
                              onClick={() => openEvidence(evidenceId)}
                              className="border border-[#2d4f2d]/40 px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#d4d4c8]/75 hover:border-[#ffbf00]/50 hover:text-[#ffbf00] bg-black/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ffbf00]/70"
                            >
                              {evidenceId}
                            </button>
                          ))}
                        </div>
                        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#8ba18b]/70 mt-3">
                          Lifecycle // {display.executionLabel}
                        </p>
                        {proposal.decision && (
                          <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-[#8ba18b]/55 mt-2">
                            Decision // {proposal.decision.decidedBy} // {new Date(proposal.decision.decidedAt).toLocaleString()}
                          </p>
                        )}
                        <p className="font-serif italic text-[11px] text-[#8ba18b]/70 mt-3">
                          Approval records consent only; high-impact execution remains policy-bound and is not performed by the Archivist.
                        </p>
                        <div className="mt-4 flex flex-col sm:flex-row gap-3">
                          <button
                            type="button"
                            onClick={() => decide(proposal.id, "approved")}
                            disabled={display.readOnly || display.controlsDisabled}
                            aria-busy={proposalBusyId === proposal.id}
                            className="flex-1 border border-[#ffbf00]/30 py-2.5 px-4 text-[10px] uppercase tracking-[0.25em] text-[#ffbf00] hover:bg-[#ffbf00]/5 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer bg-transparent focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ffbf00]/70"
                          >
                            {proposalBusyId === proposal.id ? "Recording..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            onClick={() => decide(proposal.id, "rejected")}
                            disabled={display.readOnly || display.controlsDisabled}
                            aria-busy={proposalBusyId === proposal.id}
                            className="flex-1 border border-[#2d4f2d]/50 py-2.5 px-4 text-[10px] uppercase tracking-[0.25em] text-[#8ba18b] hover:bg-[#d4d4c8]/5 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer bg-transparent focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ffbf00]/70"
                          >
                            {proposalBusyId === proposal.id ? "Recording..." : "Reject"}
                          </button>
                        </div>
                        {display.canExport && (
                          <button
                            type="button"
                            onClick={() => exportApprovedProposal(proposal)}
                            disabled={exportBusyId === proposal.id}
                            aria-busy={exportBusyId === proposal.id}
                            className="mt-3 w-full border border-[#ffbf00]/25 py-2.5 px-4 text-[10px] uppercase tracking-[0.22em] text-[#ffbf00] hover:bg-[#ffbf00]/5 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer bg-transparent focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ffbf00]/70 flex items-center justify-center gap-2"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {exportBusyId === proposal.id ? "Preparing Export" : "Prepare Confirmed Export"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>

        </div>
      )}
    </div>
  );
};
