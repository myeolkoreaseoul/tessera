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

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3500";

interface ResultSummary {
  id: string;
  projectName: string;
  institution: string;
  timestamp: string;
  stats: {
    pass: number;
    review: number;
    fail: number;
  };
}

export default function ResultsPage() {
  const router = useRouter();
  const [results, setResults] = useState<ResultSummary[]>([]);
  const [selectedResult, setSelectedResult] = useState<any>(null);

  useEffect(() => {
    // In a real app, this would fetch from /api/results
    // For now, let's mock some data if the API is not ready
    fetch(`${API_URL}/api/projects/results`)
      .then(res => res.json())
      .then(data => setResults(data))
      .catch(() => {
        setResults([
          {
            id: "1",
            projectName: "이지바로_국가신약개발재단",
            institution: "진메디신",
            timestamp: new Date().toISOString(),
            stats: { pass: 45, review: 12, fail: 3 }
          },
          {
            id: "2",
            projectName: "e나라도움_본정산",
            institution: "한국과학기술원",
            timestamp: new Date().toISOString(),
            stats: { pass: 120, review: 5, fail: 0 }
          }
        ]);
      });
  }, []);

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
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">최근 리포트</h2>
          {results.map((res) => (
            <Card 
              key={res.id} 
              className={cn(
                "cursor-pointer transition-colors hover:border-primary/40",
                selectedResult?.id === res.id && "border-primary bg-primary/5"
              )}
              onClick={() => setSelectedResult(res)}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <div className="font-bold text-sm truncate max-w-[180px]">{res.projectName}</div>
                  <Badge variant="outline" className="text-[10px]">{res.institution}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-emerald-500/10 p-1 rounded text-center">
                    <div className="text-[10px] text-emerald-500">적정</div>
                    <div className="text-xs font-bold">{res.stats.pass}</div>
                  </div>
                  <div className="bg-yellow-500/10 p-1 rounded text-center">
                    <div className="text-[10px] text-yellow-500">확인</div>
                    <div className="text-xs font-bold">{res.stats.review}</div>
                  </div>
                  <div className="bg-red-500/10 p-1 rounded text-center">
                    <div className="text-[10px] text-red-500">보완</div>
                    <div className="text-xs font-bold">{res.stats.fail}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="lg:col-span-2">
          {selectedResult ? (
            <div className="space-y-6">
              <Card className="command-panel">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-xl">{selectedResult.projectName}</CardTitle>
                    <div className="text-sm text-muted-foreground">{selectedResult.institution} | {new Date(selectedResult.timestamp).toLocaleString()}</div>
                  </div>
                  <Button variant="outline" size="sm" className="gap-2">
                    <FileText className="w-4 h-4" /> 리포트 다운로드
                  </Button>
                </CardHeader>
                <CardContent>
                   <div className="grid grid-cols-3 gap-6 mb-8">
                      <div className="flex flex-col items-center p-6 bg-slate-900/50 rounded-lg border border-slate-800">
                        <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2" />
                        <span className="text-sm text-muted-foreground">적정 (PASS)</span>
                        <span className="text-3xl font-bold text-emerald-500">{selectedResult.stats.pass}</span>
                      </div>
                      <div className="flex flex-col items-center p-6 bg-slate-900/50 rounded-lg border border-slate-800">
                        <HelpCircle className="w-8 h-8 text-yellow-500 mb-2" />
                        <span className="text-sm text-muted-foreground">확인 (REVIEW)</span>
                        <span className="text-3xl font-bold text-yellow-500">{selectedResult.stats.review}</span>
                      </div>
                      <div className="flex flex-col items-center p-6 bg-slate-900/50 rounded-lg border border-slate-800">
                        <AlertTriangle className="w-8 h-8 text-red-500 mb-2" />
                        <span className="text-sm text-muted-foreground">보완 (FAIL)</span>
                        <span className="text-3xl font-bold text-red-500">{selectedResult.stats.fail}</span>
                      </div>
                   </div>

                   <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <TableIcon className="w-5 h-5 text-primary" />
                        <h3 className="font-bold">상세 데이터 내역</h3>
                      </div>
                      <div className="border border-slate-800 rounded-md overflow-hidden">
                        <table className="w-full text-sm text-left">
                          <thead className="bg-slate-900 text-muted-foreground text-xs uppercase">
                            <tr>
                              <th className="px-4 py-3">ID</th>
                              <th className="px-4 py-3">비목</th>
                              <th className="px-4 py-3">금액</th>
                              <th className="px-4 py-3">판정</th>
                              <th className="px-4 py-3">사유</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800">
                            {[1,2,3,4,5].map((i) => (
                              <tr key={i} className="hover:bg-slate-900/30">
                                <td className="px-4 py-3 font-mono text-xs">#TR-00{i}</td>
                                <td className="px-4 py-3">연구활동비</td>
                                <td className="px-4 py-3">150,000</td>
                                <td className="px-4 py-3">
                                  <Badge variant={i % 3 === 0 ? "warning" : "success"}>
                                    {i % 3 === 0 ? "REVIEW" : "PASS"}
                                  </Badge>
                                </td>
                                <td className="px-4 py-3 text-muted-foreground">증빙 서류 적정 확인 완료</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                   </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="h-[600px] flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-xl">
               <Search className="w-16 h-16 text-slate-800 mb-4" />
               <p className="text-muted-foreground">리포트를 선택하여 상세 결과를 조회하십시오.</p>
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
