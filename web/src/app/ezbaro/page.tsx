"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface UploadResult {
  fileName: string;
  totalRows: number;
  담당자목록: { name: string; count: number }[];
  상태요약: Record<string, number>;
}

interface Task {
  작업순번: number;
  순번: number;
  전문기관: string;
  과제번호: string;
  과제명: string;
  연구수행기관: string;
  기관고유번호: string;
  기관형태: string;
  정산진행상태: string;
  집행건수: number;
  미확정: number;
  보완완료: number;
  보완요청: number;
  이행률: number | string;
  총예산: number;
  집행금액: number;
  회계사: string;
  담당자: string;
  점검날짜: string | null;
  특이사항: string;
}

interface TasksResponse {
  fileName: string;
  summary: {
    total: number;
    점검완료: number;
    보완요청: number;
    보완완료: number;
    점검중: number;
    점검전: number;
    미완료: number;
    총집행건수: number;
    총미확정: number;
  };
  tasks: Task[];
}

interface BatchStatus {
  running: boolean;
  stopping: boolean;
  total: number;
  done: number;
  errors: number;
  skipped: number;
  pending: number;
  currentIdx: number;
  currentTask: { institution: string; 과제번호: string; robotId: string } | null;
  tasks: { idx: number; institution: string; 과제번호: string; status: string; error?: string }[];
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  점검완료: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20", dot: "bg-emerald-500" },
  보완요청: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20", dot: "bg-red-500" },
  보완완료: { bg: "bg-yellow-500/10", text: "text-yellow-500", border: "border-yellow-500/20", dot: "bg-yellow-500" },
  점검중: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20", dot: "bg-blue-500" },
  점검전: { bg: "bg-slate-700", text: "text-slate-300", border: "border-slate-600", dot: "bg-slate-400" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS["점검전"];
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${c.bg} ${c.text} border ${c.border}`}>
      {status}
    </span>
  );
}

export default function EzbaroPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  // Filter state — 담당자 필수
  const [담당자, set담당자] = useState("");
  const [status, setStatus] = useState("");
  const [sortMode, setSortMode] = useState<"unchecked" | "supplement">("unchecked");
  const [tasksData, setTasksData] = useState<TasksResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Batch state
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [batchStarting, setBatchStarting] = useState(false);
  const [batchStopping, setBatchStopping] = useState(false);
  const prevRunning = useRef(false);

  // 출격 모달
  const [launchModal, setLaunchModal] = useState<{ type: "batch" | "single"; task?: Task } | null>(null);
  const [browserLaunching, setBrowserLaunching] = useState(false);
  const [browserReady, setBrowserReady] = useState(false);

  // 상태 복원 (페이지 진입 시)
  const [restoring, setRestoring] = useState(true);

  // 페이지 진입 시 서버에서 상태 복원
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/ezbaro/state`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.hasData) return;

        setUploadResult({
          fileName: data.fileName,
          totalRows: data.totalRows,
          담당자목록: data.담당자목록,
          상태요약: data.상태요약,
        });

        if (data.filter?.담당자) {
          set담당자(data.filter.담당자);
          setStatus(data.filter.status || "");
          setSortMode(data.filter.sortMode || "unchecked");

          // 자동 조회
          const params = new URLSearchParams();
          params.set("담당자", data.filter.담당자);
          if (data.filter.status) params.set("status", data.filter.status);
          params.set("sort", data.filter.sortMode || "unchecked");
          const tasksRes = await fetch(`${API_URL}/api/ezbaro/tasks?${params}`);
          if (tasksRes.ok) {
            const tasksJson: TasksResponse = await tasksRes.json();
            if (isMounted.current) setTasksData(tasksJson);
          }
        }
      } catch (e) {
        console.error("State restore error:", e);
      } finally {
        if (isMounted.current) setRestoring(false);
      }
    })();
  }, []);

  const fetchBatchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/ezbaro/batch-status`);
      if (res.ok) {
        const data: BatchStatus = await res.json();
        if (isMounted.current) setBatchStatus(data);
      }
    } catch (e) {
      console.error("Batch status fetch error:", e);
    }
  }, []);

  useEffect(() => { fetchBatchStatus(); }, [fetchBatchStatus]);

  useEffect(() => {
    // running→false 전환 시 마지막 상태를 한 번 더 fetch
    if (prevRunning.current && batchStatus && !batchStatus.running && !batchStatus.stopping) {
      fetchBatchStatus();
    }
    prevRunning.current = batchStatus?.running ?? false;

    const isActive = !batchStatus || batchStatus.running || batchStatus.stopping;
    if (!isActive) return;
    const timer = setInterval(fetchBatchStatus, 3000);
    return () => clearInterval(timer);
  }, [fetchBatchStatus, batchStatus]);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_URL}/api/ezbaro/upload`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "업로드 실패" }));
        alert(err.error || "업로드 실패");
        return;
      }
      const data: UploadResult = await res.json();
      setUploadResult(data);
      setTasksData(null);
      set담당자("");
      setStatus("");
      setSortMode("unchecked");
    } catch (e: any) {
      alert("업로드 오류: " + e.message);
    } finally {
      setUploading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  }, [handleUpload]);

  // 담당자 + 정렬 기준으로 조회 → 순번 확정
  const handleSearch = useCallback(async () => {
    if (!담당자.trim()) {
      alert("담당자를 입력해주세요.");
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("담당자", 담당자.trim());
      if (status) params.set("status", status);
      params.set("sort", sortMode);
      const res = await fetch(`${API_URL}/api/ezbaro/tasks?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "조회 실패" }));
        alert(err.error || "조회 실패");
        return;
      }
      const data: TasksResponse = await res.json();
      setTasksData(data);

      // 필터 상태 서버에 저장 (복원용)
      fetch(`${API_URL}/api/ezbaro/save-filter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 담당자: 담당자.trim(), status, sortMode }),
      }).catch(() => {});
    } catch (e: any) {
      alert("조회 오류: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [담당자, status, sortMode]);

  // Chrome 상태 확인 + 자동 실행
  const ensureBrowser = useCallback(async (): Promise<boolean> => {
    setBrowserLaunching(true);
    setBrowserReady(false);
    try {
      // 1. 현재 상태 확인
      const statusRes = await fetch(`${API_URL}/api/browser/status`);
      const statusData = await statusRes.json();
      if (statusData.status?.["9446"] === "open") {
        setBrowserReady(true);
        return true;
      }

      // 2. Chrome 자동 실행
      await fetch(`${API_URL}/api/browser/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: 9446 }),
      });

      // 3. 3초 대기 후 재확인
      await new Promise(r => setTimeout(r, 3000));
      const recheck = await fetch(`${API_URL}/api/browser/status`);
      const recheckData = await recheck.json();
      if (recheckData.status?.["9446"] === "open") {
        setBrowserReady(true);
        return true;
      }

      // 4. 한번 더 대기 (5초)
      await new Promise(r => setTimeout(r, 5000));
      const finalCheck = await fetch(`${API_URL}/api/browser/status`);
      const finalData = await finalCheck.json();
      setBrowserReady(finalData.status?.["9446"] === "open");
      return finalData.status?.["9446"] === "open";
    } catch (e) {
      console.error("Browser launch error:", e);
      return false;
    } finally {
      setBrowserLaunching(false);
    }
  }, []);

  // 전체 출격 → Chrome 확인 + 로그인 모달
  const handleBatchStart = async () => {
    if (!tasksData || tasksData.tasks.length === 0) return;
    setLaunchModal({ type: "batch" });
    await ensureBrowser();
  };

  // 모달에서 "로그인 완료, 시작" 클릭
  const confirmBatchStart = async () => {
    setLaunchModal(null);
    setBatchStarting(true);
    try {
      const res = await fetch(`${API_URL}/api/ezbaro/batch-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 담당자: 담당자.trim(), status, sort: sortMode }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || "배치 시작 실패");
      else fetchBatchStatus();
    } catch (e: any) {
      alert("배치 시작 오류: " + e.message);
    } finally {
      if (isMounted.current) setBatchStarting(false);
    }
  };

  const handleBatchStop = async () => {
    if (!confirm("진행 중인 모든 작업을 중지하시겠습니까?")) return;
    setBatchStopping(true);
    try {
      const res = await fetch(`${API_URL}/api/ezbaro/batch-stop`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) alert(data.error || "배치 중지 실패");
      else fetchBatchStatus();
    } catch (e: any) {
      alert("배치 중지 오류: " + e.message);
    } finally {
      if (isMounted.current) setBatchStopping(false);
    }
  };

  // 개별 출격 → Chrome 확인 + 로그인 모달
  const handleLaunch = async (task: Task) => {
    setLaunchModal({ type: "single", task });
    await ensureBrowser();
  };

  // 개별 출격 확정
  const confirmSingleLaunch = async (task: Task) => {
    setLaunchModal(null);
    try {
      const res = await fetch(`${API_URL}/api/robots/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: "ezbaro",
          institution: task.연구수행기관,
          task: task.과제번호,
          options: { port: 9446 },
        }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || "출격 실패");
    } catch (e: any) {
      alert("출격 오류: " + e.message);
    }
  };

  // 초기화
  const handleReset = async () => {
    if (!confirm("업로드된 데이터를 초기화하시겠습니까?\n(새 엑셀을 올릴 때 사용)")) return;
    try {
      await fetch(`${API_URL}/api/ezbaro/reset`, { method: "POST" });
      setUploadResult(null);
      setTasksData(null);
      set담당자("");
      setStatus("");
      setSortMode("unchecked");
    } catch (e: any) {
      alert("초기화 오류: " + e.message);
    }
  };

  const fmt = (n: number) => n.toLocaleString("ko-KR");

  const progressPercent = batchStatus && batchStatus.total > 0
    ? Math.round(((batchStatus.done + batchStatus.errors + batchStatus.skipped) / batchStatus.total) * 100)
    : 0;

  return (
    <div className="bg-slate-950 text-slate-100 min-h-screen">
      <div className="mx-auto max-w-screen-2xl p-4 sm:p-6 lg:p-8 flex flex-col gap-6">

        {/* Header */}
        <header className="flex items-center gap-4 pb-2 border-b border-slate-800">
          <button
            onClick={() => router.push("/")}
            className="p-2 rounded-full hover:bg-slate-800 transition-colors text-slate-400"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-2xl font-bold tracking-tight">이지바로 과제 관리</h1>
        </header>

        {/* Loading */}
        {restoring && (
          <div className="flex items-center justify-center py-12 text-slate-400 gap-3">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            상태 복원 중...
          </div>
        )}

        {/* Step 1: Upload */}
        {!restoring && <section className="bg-slate-900 rounded-xl border border-slate-800 p-6 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">엑셀 업로드</h2>
            {uploadResult && (
              <button
                onClick={handleReset}
                className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 px-3 py-1.5 rounded-lg transition-colors"
              >
                데이터 초기화
              </button>
            )}
          </div>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-700 rounded-xl p-12 flex flex-col items-center justify-center gap-4 bg-slate-950/50 hover:bg-slate-800/50 transition-colors cursor-pointer group"
          >
            <svg className="w-12 h-12 text-slate-500 group-hover:text-blue-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <div className="text-center">
              <p className="font-bold text-lg mb-1">엑셀 업로드</p>
              <p className="text-sm text-slate-400">상시점검 엑셀 파일을 드래그하거나 클릭 (.xlsx, .xlsb)</p>
            </div>
            {uploading && <p className="text-blue-400 text-sm animate-pulse">업로드 중...</p>}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xlsb,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
            />
          </div>

          {/* Upload Result Summary */}
          {uploadResult && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-slate-300">
                <span className="font-bold text-white">{uploadResult.fileName}</span>
                {" — "}총 {fmt(uploadResult.totalRows)}건
              </p>
              <div className="flex flex-wrap gap-2.5">
                {Object.entries(uploadResult.상태요약).map(([status, count]) => {
                  const c = STATUS_COLORS[status] || STATUS_COLORS["점검전"];
                  return (
                    <div key={status} className="flex items-center px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-medium">
                      <span className={`w-2 h-2 rounded-full ${c.dot} mr-2`} />
                      {status} ({count})
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>}

        {/* Step 2: 담당자 + 정렬 기준 → 조회 */}
        {uploadResult && (
          <section className="bg-slate-900 rounded-xl border border-slate-800 p-6 flex flex-col gap-5">
            <h2 className="text-lg font-bold">작업 설정</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-end">
              {/* 담당자 입력 (필수) */}
              <div className="flex flex-col gap-2">
                <label className="block text-sm font-semibold text-slate-300">
                  담당자 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={담당자}
                  onChange={(e) => set담당자(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder-slate-500 transition-colors"
                  placeholder="담당자 이름 입력 (필수)"
                />
                {/* 담당자 바로선택 칩 */}
                {uploadResult.담당자목록.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {uploadResult.담당자목록.filter((d) => d.name.trim()).map((d) => (
                      <button
                        key={d.name}
                        onClick={() => set담당자(d.name)}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                          담당자 === d.name
                            ? "bg-blue-500/20 border-blue-500 text-blue-400"
                            : "bg-slate-800 border-slate-700 hover:border-blue-500 hover:text-blue-400"
                        }`}
                      >
                        {d.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 정산진행상태 필터 */}
              <div className="flex flex-col gap-2">
                <label className="block text-sm font-semibold text-slate-300">정산진행상태</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors appearance-none"
                >
                  <option value="">전체 상태</option>
                  {Object.keys(uploadResult.상태요약).map(s => (
                    <option key={s} value={s}>{s} ({uploadResult.상태요약[s]})</option>
                  ))}
                </select>
              </div>

              {/* 정렬 기준 */}
              <div className="flex flex-col gap-2">
                <label className="block text-sm font-semibold text-slate-300">작업 순서</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSortMode("unchecked")}
                    className={`px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all ${
                      sortMode === "unchecked"
                        ? "bg-blue-500/10 border-blue-500 text-blue-400"
                        : "bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500"
                    }`}
                  >
                    미확정 순
                  </button>
                  <button
                    onClick={() => setSortMode("supplement")}
                    className={`px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all ${
                      sortMode === "supplement"
                        ? "bg-blue-500/10 border-blue-500 text-blue-400"
                        : "bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500"
                    }`}
                  >
                    보완완료 순
                  </button>
                </div>
              </div>

              {/* 조회 버튼 */}
              <button
                onClick={handleSearch}
                disabled={loading || !담당자.trim()}
                className="bg-blue-500 text-white px-6 py-2.5 rounded-lg font-bold text-sm hover:bg-blue-600 transition-colors shadow-sm disabled:opacity-50 h-[42px]"
              >
                {loading ? "조회 중..." : "작업 리스트 확정"}
              </button>
            </div>
          </section>
        )}

        {/* Step 3: 확정된 작업 리스트 + 배치 실행 */}
        {tasksData && tasksData.tasks.length > 0 && (
          <section className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col">
            {/* Summary + Actions */}
            <div className="p-6 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold mb-1">
                  작업 순서 확정 — {담당자}
                  <span className="text-sm font-normal text-slate-400 ml-3">
                    ({sortMode === "unchecked" ? "미확정 많은 순" : "보완완료 많은 순"})
                  </span>
                </h2>
                <p className="text-sm text-slate-400">
                  총 <span className="font-bold text-white">{fmt(tasksData.summary.total)}건</span>
                  <span className="mx-2">|</span>
                  미확정 합계: <span className="font-bold text-red-400">{fmt(tasksData.summary.총미확정)}건</span>
                  <span className="mx-2">|</span>
                  점검완료: {tasksData.summary.점검완료}
                  <span className="mx-2">|</span>
                  보완요청: <span className="text-red-400">{tasksData.summary.보완요청}</span>
                  <span className="mx-2">|</span>
                  미완료: <span className="text-yellow-400">{tasksData.summary.미완료}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBatchStart}
                  disabled={batchStarting || batchStatus?.running || batchStatus?.stopping}
                  className="bg-amber-500 text-white px-8 py-2.5 rounded-lg font-bold text-sm hover:bg-amber-600 transition-colors shadow-sm disabled:opacity-50"
                >
                  {batchStarting ? "시작 중..." : `전체 출격 (${tasksData.summary.total}건)`}
                </button>
                {(batchStatus?.running || batchStatus?.stopping) && (
                  <button
                    onClick={handleBatchStop}
                    disabled={batchStopping || batchStatus?.stopping}
                    className="bg-red-500 text-white px-6 py-2.5 rounded-lg font-bold text-sm hover:bg-red-600 transition-colors shadow-sm disabled:opacity-50"
                  >
                    {(batchStopping || batchStatus?.stopping) ? "중지 중..." : "긴급 정지"}
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-800/80 border-b border-slate-700 text-sm font-semibold text-slate-300">
                    <th className="px-4 py-3 text-center w-20">작업순서</th>
                    <th className="px-4 py-3">전문기관</th>
                    <th className="px-4 py-3">과제번호</th>
                    <th className="px-4 py-3">연구수행기관</th>
                    <th className="px-4 py-3">상태</th>
                    <th className="px-4 py-3 text-right">집행건수</th>
                    <th className="px-4 py-3 text-right">미확정</th>
                    <th className="px-4 py-3 text-right">보완완료</th>
                    <th className="px-4 py-3 text-center w-20">액션</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-slate-800/60">
                  {tasksData.tasks.map((task, i) => (
                    <tr
                      key={`${task.과제번호}-${i}`}
                      className={`hover:bg-slate-800/40 transition-colors ${i % 2 === 1 ? "bg-slate-800/20" : ""}`}
                    >
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 font-bold text-sm">
                          {task.작업순번}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300 max-w-[180px] truncate">{task.전문기관}</td>
                      <td className="px-4 py-3 font-mono text-slate-400">{task.과제번호}</td>
                      <td className="px-4 py-3 font-bold">{task.연구수행기관}</td>
                      <td className="px-4 py-3"><StatusBadge status={task.정산진행상태} /></td>
                      <td className="px-4 py-3 text-right font-mono text-slate-300">{fmt(task.집행건수)}</td>
                      <td className={`px-4 py-3 text-right font-mono ${task.미확정 > 0 ? "font-bold text-red-400" : "text-slate-500"}`}>
                        {fmt(task.미확정)}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono ${task.보완완료 > 0 ? "font-bold text-yellow-400" : "text-slate-500"}`}>
                        {fmt(task.보완완료)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleLaunch(task)}
                          className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded text-xs font-bold transition-colors shadow-sm"
                        >
                          출격
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-slate-800 bg-slate-900/50">
              <span className="text-sm text-slate-400">
                총 {fmt(tasksData.tasks.length)}건 — 위 순서대로 배치 실행됩니다
              </span>
            </div>
          </section>
        )}

        {tasksData && tasksData.tasks.length === 0 && (
          <div className="h-40 flex items-center justify-center border-2 border-dashed border-slate-800 rounded-xl">
            <p className="text-slate-500">해당 담당자의 과제가 없습니다.</p>
          </div>
        )}

        {/* 로그인 확인 모달 */}
        {launchModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 max-w-md w-full shadow-2xl flex flex-col gap-6">
              <h3 className="text-xl font-bold text-center">
                {launchModal.type === "batch" ? "전체 출격 준비" : "출격 준비"}
              </h3>

              {browserLaunching ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <svg className="w-8 h-8 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <p className="text-sm text-slate-300">Chrome 브라우저를 실행하고 있습니다...</p>
                </div>
              ) : browserReady ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                    <span className="w-3 h-3 rounded-full bg-emerald-500" />
                    <span className="text-sm text-emerald-400 font-semibold">Chrome 브라우저 준비 완료</span>
                  </div>
                  <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-sm text-yellow-300 font-bold mb-1">이지바로에 로그인되어 있는지 확인하세요</p>
                    <p className="text-xs text-slate-400">
                      Chrome에서 이지바로 사이트에 접속하여 로그인한 뒤 아래 버튼을 눌러주세요.
                    </p>
                  </div>
                  {launchModal.type === "single" && launchModal.task && (
                    <div className="text-sm text-slate-400">
                      대상: <span className="font-bold text-white">{launchModal.task.연구수행기관}</span>
                      <span className="text-slate-600 mx-1">|</span>
                      <span className="font-mono">{launchModal.task.과제번호}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                    <span className="text-red-400 text-xl">!</span>
                  </div>
                  <p className="text-sm text-red-400">Chrome 브라우저를 실행할 수 없습니다.</p>
                  <p className="text-xs text-slate-500">회사 PC의 Chrome이 실행 중인지 확인해주세요.</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setLaunchModal(null)}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-slate-700 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  취소
                </button>
                {browserReady && (
                  <button
                    onClick={() => {
                      if (launchModal.type === "batch") {
                        confirmBatchStart();
                      } else if (launchModal.task) {
                        confirmSingleLaunch(launchModal.task);
                      }
                    }}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 transition-colors shadow-sm"
                  >
                    로그인 완료, 시작
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Batch Progress Panel */}
        {batchStatus && (batchStatus.running || batchStatus.tasks.length > 0) && (
          <section className="bg-slate-900 rounded-xl border border-slate-800 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold flex items-center gap-2">
                배치 진행 현황
                {batchStatus.running && <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />}
              </h2>
              <div className="text-sm text-slate-400">
                {batchStatus.done} / {batchStatus.total} ({progressPercent}%)
              </div>
            </div>

            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${progressPercent}%` }} />
            </div>

            {batchStatus.currentTask && (
              <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800 flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">현재 진행 중</p>
                  <p className="text-sm font-bold text-blue-400">
                    {batchStatus.currentTask.institution}
                    <span className="text-slate-500 mx-2 text-xs font-normal">|</span>
                    {batchStatus.currentTask.과제번호}
                  </p>
                </div>
                <div className="text-xs text-slate-500 font-mono">
                  ROBOT ID: {batchStatus.currentTask.robotId}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-slate-800/50 p-3 rounded-lg text-center border border-slate-700/50">
                <p className="text-xs text-slate-500 mb-1">완료</p>
                <p className="text-lg font-bold text-emerald-400">{batchStatus.done}</p>
              </div>
              <div className="bg-slate-800/50 p-3 rounded-lg text-center border border-slate-700/50">
                <p className="text-xs text-slate-500 mb-1">오류</p>
                <p className="text-lg font-bold text-red-400">{batchStatus.errors}</p>
              </div>
              <div className="bg-slate-800/50 p-3 rounded-lg text-center border border-slate-700/50">
                <p className="text-xs text-slate-500 mb-1">제외</p>
                <p className="text-lg font-bold text-yellow-500">{batchStatus.skipped}</p>
              </div>
              <div className="bg-slate-800/50 p-3 rounded-lg text-center border border-slate-700/50">
                <p className="text-xs text-slate-500 mb-1">대기</p>
                <p className="text-lg font-bold text-slate-400">{batchStatus.pending}</p>
              </div>
            </div>

            <div className="mt-2 max-h-40 overflow-y-auto pr-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {batchStatus.tasks.slice().reverse().slice(0, 20).map((t) => (
                  <div key={`${t.과제번호}-${t.idx}`} className="flex items-center gap-3 p-2 rounded bg-slate-950/30 border border-slate-800/50 text-xs">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      t.status === "pending" ? "bg-slate-600" :
                      t.status === "running" ? "bg-blue-500 animate-pulse" :
                      t.status === "done" ? "bg-emerald-500" :
                      t.status === "error" ? "bg-red-500" :
                      t.status === "skipped" ? "bg-yellow-500" : "bg-slate-400"
                    }`} />
                    <span className="truncate flex-1 text-slate-300">{t.institution}</span>
                    <span className="font-mono text-slate-500 shrink-0">{t.과제번호}</span>
                    {t.error && <span className="text-red-500 truncate max-w-[100px]" title={t.error}>{t.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
