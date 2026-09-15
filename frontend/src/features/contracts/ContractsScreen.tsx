"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { EmptyState, ErrorState, PageLoading } from "@/components/ui/display";
import { useDialogs } from "@/components/ui/Dialogs";
import { FilterPill } from "@/components/ui/filters";
import { useToast } from "@/components/ui/Toast";
import { Markdown } from "@/features/rich/Markdown";
import { date, relative } from "@/lib/format";
import { useApi, useInvalidate } from "@/lib/query";
import { CONTRACTS_PATH, deleteTemplate, TEMPLATES_PATH } from "./api";
import { useOpenContractNew } from "./components/ContractNewForm";
import {
  ContractTemplateRow,
  useContractTemplateForm,
} from "./components/ContractTemplateForm";
import {
  contractFilters,
  contractKindLabels,
  contractStatusLabels,
  contractStatusTones,
  contractTodoText,
} from "./labels";
import type { ContractRow, ContractTemplates } from "./types";

/* สัญญา / TOR on the organization's side (admins and team leads): the list with its status pills (?status=, "todo"
   is what waits for the team), and the organization's templates (?tab=templates). */

export function ContractsScreen({
  status = "",
  tab = "",
}: {
  status?: string;
  tab?: string;
}) {
  if (tab === "templates") return <ContractTemplatesScreen />;
  return <ContractList status={status} />;
}

function ContractList({ status }: { status: string }) {
  const q = useApi<{ contracts: ContractRow[] }>(CONTRACTS_PATH);
  const router = useRouter();
  const openContractNew = useOpenContractNew();
  if (q.isPending) return <PageLoading />;
  if (q.error)
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const key = status in contractFilters ? status : "";
  const all = q.data.contracts;
  const match = (c: ContractRow, filter: string) =>
    !filter ||
    (filter === "todo" ? Boolean(contractTodoText(c)) : c.status === filter);
  const count = (filter: string) => all.filter((c) => match(c, filter)).length;
  const shown = all.filter((c) => match(c, key));
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>สัญญา / TOR</h1>
          <p>
            ร่างข้อตกลงกับลูกค้า ส่งให้ตรวจ ลงนามออนไลน์
            และติดตามงวดงานในที่เดียว
          </p>
        </div>
        <div className="flex wrap">
          <Link className="btn subtle" href="/contracts?tab=templates">
            <Icon name="book" />
            แม่แบบ
          </Link>
          <button
            type="button"
            className="btn primary"
            onClick={() => void openContractNew()}
          >
            <Icon name="plus" />
            สร้างเอกสาร
          </button>
        </div>
      </div>
      <section className="card">
        <div className="filters">
          <div className="filter-pills" role="group" aria-label="สถานะเอกสาร">
            {Object.entries(contractFilters).map(([value, label]) => (
              <FilterPill
                key={value}
                label={label}
                value={value}
                pressed={value === key}
                count={count(value)}
                warning={value === "todo" && count(value) > 0}
                onClick={(next) =>
                  router.replace(
                    next ? `/contracts?status=${next}` : "/contracts",
                  )
                }
              />
            ))}
          </div>
        </div>
        {shown.length ? (
          <div className="table-scroll">
            <table className="contract-table">
              <thead>
                <tr>
                  <th>เอกสาร</th>
                  <th>ลูกค้า (ผู้ว่าจ้าง)</th>
                  <th>สถานะ</th>
                  <th>ความคืบหน้า</th>
                  <th>เวอร์ชัน</th>
                  <th>งวดถัดไป</th>
                  <th>อัปเดต</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const todo = contractTodoText(c);
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link
                          className="contract-link"
                          href={`/contracts/${c.id}`}
                          title={c.title}
                        >
                          {c.title}
                        </Link>
                        <span className="muted">
                          {c.reference} · {contractKindLabels[c.kind]}
                        </span>
                      </td>
                      <td>
                        <span className="contract-person">
                          {c.customer_name}
                        </span>
                        <span className="muted">{c.customer_email}</span>
                      </td>
                      <td>
                        <span
                          className={`customer-state tone-${contractStatusTones[c.status]}`}
                        >
                          {contractStatusLabels[c.status]}
                        </span>
                        {todo && <span className="contract-todo">{todo}</span>}
                      </td>
                      <td>
                        {c.progress == null ? (
                          "-"
                        ) : (
                          <span className="project-mini">
                            <progress
                              className="project-meter sm"
                              max={100}
                              value={c.progress}
                            >
                              {c.progress}%
                            </progress>
                            {c.progress}%
                          </span>
                        )}
                      </td>
                      <td>{c.version || "ร่าง 1.0"}</td>
                      <td>{c.next_due ? date(c.next_due) : "-"}</td>
                      <td>{relative(c.updated_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card-body">
            <EmptyState
              title={key ? "ไม่มีเอกสารในสถานะนี้" : "ยังไม่มีสัญญาหรือ TOR"}
              description="กด “สร้างเอกสาร” เพื่อเริ่มจากแม่แบบ ไฟล์ Word หรือเอกสารเปล่า"
              icon="file"
            />
          </div>
        )}
      </section>
    </>
  );
}

/** The organization's own templates, and the platform's standard ones to start from. */
function ContractTemplatesScreen() {
  const q = useApi<ContractTemplates>(TEMPLATES_PATH);
  const { openModal, confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const openForm = useContractTemplateForm();
  if (q.isPending) return <PageLoading />;
  if (q.error)
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const t = q.data;
  return (
    <>
      <Link href="/contracts" className="back-link">
        <Icon name="back" />
        สัญญา / TOR ทั้งหมด
      </Link>
      <div className="page-heading">
        <div>
          <h1>แม่แบบสัญญา / TOR</h1>
          <p>
            คำที่แทนค่าได้เมื่อสร้างเอกสาร:{" "}
            <code>{t.placeholders.map((p) => `{${p}}`).join(" ")}</code>
          </p>
        </div>
        <div className="flex">
          <button
            type="button"
            className="btn primary"
            onClick={() => openForm()}
          >
            <Icon name="plus" />
            สร้างแม่แบบ
          </button>
        </div>
      </div>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>แม่แบบขององค์กร</h2>
            <p>ใช้ได้เฉพาะในองค์กรนี้</p>
          </div>
        </div>
        {t.organization.length ? (
          <ul className="contract-template-list">
            {t.organization.map((item) => (
              <ContractTemplateRow
                key={item.id}
                template={item}
                editable
                onEdit={() => openForm(item)}
                onDelete={() =>
                  confirm({
                    title: "ลบแม่แบบ",
                    message: "เอกสารที่สร้างจากแม่แบบนี้แล้วไม่เปลี่ยน",
                    cancelLabel: "ไม่ลบ",
                    confirmLabel: "ลบแม่แบบ",
                    tone: "danger",
                    run: async () => {
                      await deleteTemplate(item.id);
                      toast("ลบแม่แบบแล้ว");
                      await refresh(TEMPLATES_PATH);
                    },
                  })
                }
              />
            ))}
          </ul>
        ) : (
          <div className="card-body">
            <p className="muted">
              ยังไม่มีแม่แบบขององค์กร เริ่มจากแม่แบบมาตรฐานด้านล่างได้
            </p>
          </div>
        )}
      </section>
      <section className="card mt">
        <div className="card-header">
          <div>
            <h2>แม่แบบมาตรฐานจาก Bookdose</h2>
            <p>ทีม Bookdose ดูแล ใช้ได้ทุกองค์กร</p>
          </div>
        </div>
        <ul className="contract-template-list">
          {t.platform.map((item) => (
            <ContractTemplateRow
              key={item.id}
              template={item}
              editable={false}
              onView={() =>
                openModal(
                  item.title,
                  <Markdown className="article-content" text={item.body} />,
                  { wide: true },
                )
              }
            />
          ))}
        </ul>
      </section>
    </>
  );
}
