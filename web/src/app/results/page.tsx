"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  Search,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Table as TableIcon,
  ChevronLeft
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface ResultFile {
  name: string;
  file: string;
  size: number;
  modified: string;
}

export default function ResultsPage() {
  const router = useRouter();
  const [results, setResults] = useState<ResultFile[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [detail, setDetail] = useState<any[] | null>(null);
  const [stats, setStats] = useState<{ pass: number; review: number; fail: number } | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/projects/results`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setResults(data);
      })
      .catch(() => setResults([]));
  }, []);

  const loadDetail = async (name: string) => {
    setSelectedName(name);
    try {
      const res = await fetch(`${API_URL}/api/projects/results/${encodeURIComponent(name)}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setDetail(data);
        const pass = data.filter((r: any) => r.status === '적정' || r.status === 'PASS').length;
        const review = data.filter((r: any) => r.status === '확인' || r.status === 'REVIEW').length;
        const fail = data.filter((r: any) => r.status === '보완요청' || r.status === 'FAIL' || r.status === 'SKIP').length;
        setStats({ pass, review, fail });
      } else {
        setDetail(null);
        setStats(null);
      }
    } catch {
      setDetail(null);
      setStats(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex justify-between items-center border-b border-slate-800 pb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/")}>
            <ChevronLeft className="w-6 h-6" />
          </Button>
          <h1 className="text-3xl font-bold tracking-tighter text-foreground">
            정산 <span className="text-primary">분석 결과</span>
          </h1>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
            결과 파일 ({results.length}개)
          </h2>
          {results.length === 0 && (
            <div className="text-sm text-muted-foreground p-4">결과 파일이 없습니다.</div>
          )}
          {results.map((res) => (
            <Card
              key={res.name}
              className={cn(
                "cursor-pointer transition-colors hover:border-primary/40",
                selectedName === res.name && "border-primary bg-primary/5"
              )}
              onClick={() => loadDetail(res.name)}
            >
              <CardContent className="p-4 space-y-2">
                <div className="font-bold text-sm truncate">{res.name}</div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatSize(res.size)}</span>
                  <span>{new Date(res.modified).toLocaleDateString()}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="lg:col-span-2">
          {selectedName && stats ? (
            <div className="space-y-6">
              <Card className="command-panel">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-xl">{selectedName}</CardTitle>
                    <div className="text-sm text-muted-foreground">
                      총 {detail?.length || 0}건
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                   <div className="grid grid-cols-3 gap-6 mb-8">
                      <div className="flex flex-col items-center p-6 bg-slate-900/50 rounded-lg border border-slate-800">
                        <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2" />
                        <span className="text-sm text-muted-foreground">적정</span>
                        <span className="text-3xl font-bold text-emerald-500">{stats.pass}</span>
                      </div>
                      <div className="flex flex-col items-center p-6 bg-slate-900/50 rounded-lg border border-slate-800">
                        <HelpCircle className="w-8 h-8 text-yellow-500 mb-2" />
                        <span className="text-sm text-muted-foreground">확인</span>
                        <span className="text-3xl font-bold text-yellow-500">{stats.review}</span>
                      </div>
                      <div className="flex flex-col items-center p-6 bg-slate-900/50 rounded-lg border border-slate-800">
                        <AlertTriangle className="w-8 h-8 text-red-500 mb-2" />
                        <span className="text-sm text-muted-foreground">보완/SKIP</span>
                        <span className="text-3xl font-bold text-red-500">{stats.fail}</span>
                      </div>
                   </div>

                   <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <TableIcon className="w-5 h-5 text-primary" />
                        <h3 className="font-bold">상세 내역</h3>
                      </div>
                      <div className="border border-slate-800 rounded-md overflow-hidden max-h-[500px] overflow-y-auto">
                        <table className="w-full text-sm text-left">
                          <thead className="bg-slate-900 text-muted-foreground text-xs uppercase sticky top-0">
                            <tr>
                              <th className="px-4 py-3">순번</th>
                              <th className="px-4 py-3">판정</th>
                              <th className="px-4 py-3">사유</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800">
                            {(detail || []).slice(0, 100).map((item: any, i: number) => (
                              <tr key={i} className="hover:bg-slate-900/30">
                                <td className="px-4 py-3 font-mono text-xs">R{item.rowNum || i + 1}</td>
                                <td className="px-4 py-3">
                                  <Badge variant={
                                    item.status === '적정' || item.status === 'PASS' ? "success" :
                                    item.status === '확인' || item.status === 'REVIEW' ? "warning" :
                                    "destructive"
                                  }>
                                    {item.status}
                                  </Badge>
                                </td>
                                <td className="px-4 py-3 text-muted-foreground text-xs max-w-[400px] truncate">
                                  {item.comment || '-'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {(detail?.length || 0) > 100 && (
                        <div className="text-xs text-muted-foreground text-center">
                          상위 100건만 표시 (총 {detail?.length}건)
                        </div>
                      )}
                   </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="h-[600px] flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-xl">
               <Search className="w-16 h-16 text-slate-800 mb-4" />
               <p className="text-muted-foreground">결과 파일을 선택하여 상세 결과를 조회하십시오.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ");
}
