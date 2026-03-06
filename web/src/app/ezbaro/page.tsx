"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface UploadResult {
  fileName: string;
  totalRows: number;
  담당자목록: { name: string; count: number }[];
  상태요약: Record<string, number>;
}

interface Task {
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

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  // Filter state
  const [담당자, set담당자] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tasksData, setTasksData] = useState<TasksResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Sort state
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

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

  const handleSearch = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (담당자.trim()) params.set("담당자", 담당자.trim());
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`${API_URL}/api/ezbaro/tasks?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "조회 실패" }));
        alert(err.error || "조회 실패");
        return;
      }
      const data: TasksResponse = await res.json();
      setTasksData(data);
    } catch (e: any) {
      alert("조회 오류: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [담당자, statusFilter]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  };

  const sortedTasks = (() => {
    if (!tasksData?.tasks) return [];
    if (!sortCol) return tasksData.tasks;
    const list = [...tasksData.tasks];
    list.sort((a: any, b: any) => {
      const va = a[sortCol] ?? "";
      const vb = b[sortCol] ?? "";
      if (typeof va === "number" && typeof vb === "number") return sortAsc ? va - vb : vb - va;
      return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    return list;
  })();

  const handleLaunch = (task: Task) => {
    const params = new URLSearchParams({
      system: "ezbaro",
      institution: task.연구수행기관,
      task: task.과제번호,
    });
    router.push(`/launch?${params}`);
  };

  const fmt = (n: number) => n.toLocaleString("ko-KR");

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

        {/* Section 1: Upload */}
        <section className="bg-slate-900 rounded-xl border border-slate-800 p-6 flex flex-col gap-6">
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
              <p className="font-bold text-lg mb-1">파일 업로드</p>
              <p className="text-sm text-slate-400">엑셀 파일을 드래그하거나 클릭하여 업로드하세요 (.xlsx, .xlsb)</p>
            </div>
            {uploading && <p className="text-blue-400 text-sm animate-pulse">업로드 중...</p>}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xlsb,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
            />
          </div>

          {/* Upload Result */}
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
              {uploadResult.담당자목록.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="text-xs text-slate-500 mr-1">담당자:</span>
                  {uploadResult.담당자목록.map((d) => (
                    <button
                      key={d.name}
                      onClick={() => { set담당자(d.name); }}
                      className="text-xs px-2 py-0.5 rounded bg-slate-800 border border-slate-700 hover:border-blue-500 hover:text-blue-400 transition-colors"
                    >
                      {d.name} ({d.count})
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Section 2: Filters */}
        {uploadResult && (
          <section className="bg-slate-900 rounded-xl border border-slate-800 p-6 flex flex-col gap-5">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[240px] max-w-sm">
                <label className="block text-sm font-semibold mb-2 text-slate-300">담당자</label>
                <input
                  type="text"
                  value={담당자}
                  onChange={(e) => set담당자(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder-slate-500 transition-colors"
                  placeholder="이름 입력..."
                />
              </div>
              <div className="flex-1 min-w-[240px] max-w-sm">
                <label className="block text-sm font-semibold mb-2 text-slate-300">상태</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                >
                  <option value="">전체</option>
                  <option>점검완료</option>
                  <option>보완요청</option>
                  <option>보완완료</option>
                  <option>점검중</option>
                  <option>점검전</option>
                </select>
              </div>
              <button
                onClick={handleSearch}
                disabled={loading}
                className="bg-blue-500 text-white px-8 py-2.5 rounded-lg font-semibold text-sm hover:bg-blue-600 transition-colors shadow-sm flex items-center gap-2 h-[42px] disabled:opacity-50"
              >
                {loading ? "조회 중..." : "조회"}
              </button>
            </div>

            {/* Summary */}
            {tasksData && (
              <div className="pt-4 border-t border-slate-800 flex items-center gap-2">
                <p className="text-sm font-medium text-slate-300">
                  <span className="font-bold text-white">총 {fmt(tasksData.summary.total)}건</span>
                  <span className="text-slate-600 mx-2">|</span>
                  점검완료: {tasksData.summary.점검완료}
                  <span className="text-slate-600 mx-2">|</span>
                  보완요청: <span className="text-red-400 font-bold">{tasksData.summary.보완요청}</span>
                  <span className="text-slate-600 mx-2">|</span>
                  미완료: <span className="text-yellow-400 font-bold">{tasksData.summary.미완료}</span>
                  <span className="text-slate-600 mx-2">|</span>
                  미확정 합계: <span className="text-blue-400 font-bold">{fmt(tasksData.summary.총미확정)}건</span>
                </p>
              </div>
            )}
          </section>
        )}

        {/* Section 3: Table */}
        {tasksData && tasksData.tasks.length > 0 && (
          <section className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col">
            <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-800/80 border-b border-slate-700 text-sm font-semibold text-slate-300">
                    {[
                      { key: "순번", label: "순번", center: true },
                      { key: "전문기관", label: "전문기관" },
                      { key: "과제번호", label: "과제번호" },
                      { key: "연구수행기관", label: "연구수행기관" },
                      { key: "정산진행상태", label: "상태" },
                      { key: "집행건수", label: "집행건수", right: true },
                      { key: "미확정", label: "미확정", right: true },
                      { key: "담당자", label: "담당자" },
                    ].map((col) => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className={`px-4 py-3 cursor-pointer hover:text-white select-none ${col.center ? "text-center w-16" : ""} ${col.right ? "text-right" : ""}`}
                      >
                        {col.label}
                        {sortCol === col.key && (sortAsc ? " ▲" : " ▼")}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center w-24">액션</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-slate-800/60">
                  {sortedTasks.map((task, i) => (
                    <tr
                      key={`${task.순번}-${i}`}
                      className={`hover:bg-slate-800/40 transition-colors ${i % 2 === 1 ? "bg-slate-800/20" : ""}`}
                    >
                      <td className="px-4 py-3 text-center font-mono text-slate-400">{String(task.순번).padStart(3, "0")}</td>
                      <td className="px-4 py-3 text-slate-300 max-w-[180px] truncate">{task.전문기관}</td>
                      <td className="px-4 py-3 font-mono text-slate-400">{task.과제번호}</td>
                      <td className="px-4 py-3 font-bold">{task.연구수행기관}</td>
                      <td className="px-4 py-3"><StatusBadge status={task.정산진행상태} /></td>
                      <td className="px-4 py-3 text-right font-mono text-slate-300">{fmt(task.집행건수)}</td>
                      <td className={`px-4 py-3 text-right font-mono ${task.미확정 > 0 ? "font-bold text-red-400" : "text-slate-500"}`}>
                        {fmt(task.미확정)}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{task.담당자}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleLaunch(task)}
                          className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded text-xs font-bold transition-colors shadow-sm w-full"
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
                총 {fmt(sortedTasks.length)}건 표시
              </span>
            </div>
          </section>
        )}

        {tasksData && tasksData.tasks.length === 0 && (
          <div className="h-40 flex items-center justify-center border-2 border-dashed border-slate-800 rounded-xl">
            <p className="text-muted-foreground text-slate-500">조건에 맞는 과제가 없습니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
