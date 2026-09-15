"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Icon } from "@/components/Icon";
import { TextField, useFieldValidation } from "@/components/ui/fields";
import { FileInput } from "@/components/ui/FileInput";
import { Form } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import { requestSignCode, signContract } from "../api";
import { contractKindLabels } from "../labels";
import type { ContractKind } from "../types";

/* The signing box (pages/contracts/contract-sign-box.html): draw, type or upload a signature, then confirm who you
   are with a one-time code by email (or the account password while the platform cannot send email). Both sides use
   it: `base` is the document's API address (/api/contracts/<id> for the organization's admin,
   /api/public/<org>/contracts/<id> for the customer). */

type Method = "draw" | "type" | "upload";

// An uploaded signature is scaled down (and saved as PNG) so it stays small.
function signatureImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 600 / img.width, 240 / img.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas
        .getContext("2d")
        ?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("อ่านรูปลายเซ็นไม่ได้ ใช้ไฟล์ PNG หรือ JPG"));
    };
    img.src = url;
  });
}

export function ContractSignBox({
  base,
  side,
  name,
  kind,
  reference,
  version,
  onSigned,
}: {
  base: string;
  side: "org" | "customer";
  /** The signer's name to start from. */
  name: string;
  kind: ContractKind;
  reference: string;
  version: string;
  /** After signing (refresh the document). */
  onSigned: () => Promise<unknown> | unknown;
}) {
  const toast = useToast();
  const [method, setMethod] = useState<Method>("draw");
  const [verify, setVerify] = useState<"" | "email" | "password">("");
  const [sentTo, setSentTo] = useState("");
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [upload, setUpload] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const secret = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const signed = useRef(false);
  const kindLabel = contractKindLabels[kind];
  // The old form said "กรุณากรอกข้อมูลช่องนี้" inside the agreement line when it was left unticked.
  const agreeCheck = useFieldValidation();

  // The code field opens with the cursor in it (the old code focused it right after showing it).
  useEffect(() => {
    if (verify && secret.current) {
      secret.current.value = "";
      secret.current.focus();
    }
  }, [verify, sentTo]);

  // A drawn signature: pointer strokes on the canvas, the same with a mouse, a pen or a finger.
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const node = event.currentTarget;
    const rect = node.getBoundingClientRect();
    const scale = node.width / rect.width;
    return [
      (event.clientX - rect.left) * scale,
      (event.clientY - rect.top) * scale,
    ] as const;
  };
  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const node = event.currentTarget;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    event.preventDefault();
    // Keeps the stroke when the pointer leaves the box; a pointer the browser no longer tracks cannot be captured.
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      /* draw without capture */
    }
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1e293b";
    ctx.beginPath();
    ctx.moveTo(...point(event));
    drawing.current = true;
    signed.current = true;
  };
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = event.currentTarget.getContext("2d");
    if (!ctx) return;
    ctx.lineTo(...point(event));
    ctx.stroke();
  };
  const stop = () => {
    drawing.current = false;
  };
  const clear = () => {
    const node = canvas.current;
    node?.getContext("2d")?.clearRect(0, 0, node.width, node.height);
    signed.current = false;
  };

  const askCode = async () => {
    setAsking(true);
    try {
      const result = await requestSignCode(base);
      setVerify(result.method);
      setSentTo(result.method === "email" ? result.sent_to : "");
      if (result.method === "email") toast("ส่งรหัสยืนยันทางอีเมลแล้ว");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setAsking(false);
    }
  };

  const mark = (): string => {
    if (method === "type") {
      const text = typed.trim();
      if (!text) throw new Error("กรุณาพิมพ์ชื่อสำหรับลายเซ็น");
      return text;
    }
    if (method === "upload") {
      if (!upload) throw new Error("กรุณาเลือกรูปลายเซ็น");
      return upload;
    }
    if (!signed.current || !canvas.current)
      throw new Error("กรุณาวาดลายเซ็นในกรอบ");
    return canvas.current.toDataURL("image/png");
  };

  const tab = (value: Method, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={method === value}
      onClick={() => setMethod(value)}
    >
      {label}
    </button>
  );

  return (
    <Form
      className="card signature-box no-print"
      onSubmit={async (values, form) => {
        if (!verify) throw new Error("กรุณากด “ขอรหัสยืนยันตัวตน” ก่อนลงนาม");
        const signature = mark();
        const agree = (form.elements.namedItem("agree") as HTMLInputElement)
          .checked;
        await signContract(base, {
          name: values.name,
          method,
          mark: signature,
          agree,
          [verify === "email" ? "code" : "password"]: values.secret || "",
        });
        toast(
          side === "org"
            ? "ลงนามแล้ว เอกสารปิดผนึกเรียบร้อย"
            : "ลงนามแล้ว รอผู้รับจ้างลงนาม",
        );
        await onSigned();
      }}
    >
      <div className="card-header">
        <div>
          <h2>{side === "org" ? "ลงนามในนามผู้รับจ้าง" : "ลงนามเอกสาร"}</h2>
          <p>
            {kindLabel} {reference} เวอร์ชัน {version}
          </p>
        </div>
        <Icon name="edit" />
      </div>
      <div className="card-body">
        <TextField
          id="sign-name"
          label="ชื่อผู้ลงนาม"
          name="name"
          defaultValue={name}
          max={100}
        />
        <div
          className="signature-tabs"
          role="tablist"
          aria-label="วิธีลงลายเซ็น"
        >
          {tab("draw", "วาดลายเซ็น")}
          {tab("type", "พิมพ์ชื่อ")}
          {tab("upload", "อัปโหลดรูป")}
        </div>
        <input type="hidden" name="method" value={method} />
        <div className="signature-pane" hidden={method !== "draw"}>
          <canvas
            ref={canvas}
            className="signature-canvas"
            width={560}
            height={180}
            aria-label="พื้นที่วาดลายเซ็น ใช้เมาส์ ปากกา หรือนิ้ว"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stop}
            onPointerCancel={stop}
          />
          <button type="button" className="btn sm subtle" onClick={clear}>
            ล้างลายเซ็น
          </button>
        </div>
        <div className="signature-pane" hidden={method !== "type"}>
          <label className="sr-only" htmlFor="sign-typed">
            พิมพ์ชื่อสำหรับลายเซ็น
          </label>
          <input
            id="sign-typed"
            name="typed"
            maxLength={100}
            placeholder="พิมพ์ชื่อ-นามสกุล"
            onInput={(e) => setTyped(e.currentTarget.value)}
          />
          <div className="signature-preview signature-typed" aria-hidden="true">
            {typed}
          </div>
        </div>
        <div className="signature-pane" hidden={method !== "upload"}>
          {/* The shared picker also runs the general file check, as every file input did before. */}
          <FileInput
            name="upload"
            multiple={false}
            accept=".png,.jpg,.jpeg"
            aria-label="เลือกรูปลายเซ็น PNG หรือ JPG"
            onFiles={async (files) => {
              const file = files[0];
              if (!file) return;
              try {
                setUpload(await signatureImage(file));
              } catch (error) {
                toast(
                  error instanceof Error ? error.message : String(error),
                  true,
                );
              }
            }}
          />
          {/* A data: URL made in the browser from the chosen picture. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="signature-upload-preview"
            alt="ตัวอย่างลายเซ็น"
            src={upload || undefined}
            hidden={!upload}
          />
        </div>
        <label className="check contract-agree">
          <input type="checkbox" name="agree" required {...agreeCheck.bind} />
          <span>
            ข้าพเจ้าอ่านและยอมรับ{kindLabel} {reference} เวอร์ชัน {version}{" "}
            ทั้งฉบับ
            และตกลงให้ลายมือชื่ออิเล็กทรอนิกส์นี้มีผลเช่นเดียวกับการลงลายมือชื่อ
          </span>
          {agreeCheck.errorNode}
        </label>
        <div className="signature-verify">
          <button
            type="button"
            className="btn"
            disabled={asking}
            onClick={() => void askCode()}
          >
            <Icon name="mail" />
            {verify ? "ขอรหัสอีกครั้ง" : "ขอรหัสยืนยันตัวตน"}
          </button>
          <div className="field" hidden={!verify}>
            <label htmlFor="sign-secret">
              {!verify
                ? "รหัส OTP"
                : verify === "email"
                  ? `รหัส 6 หลักที่ส่งไปที่ ${sentTo}`
                  : "รหัสผ่านบัญชีของคุณ"}
            </label>
            <input
              ref={secret}
              id="sign-secret"
              name="secret"
              type={verify === "password" ? "password" : "text"}
              inputMode={verify === "password" ? "text" : "numeric"}
              autoComplete="one-time-code"
              maxLength={200}
            />
          </div>
          <p className="tiny muted">
            {!verify
              ? "ระบบส่งรหัส 6 หลักไปที่อีเมลของคุณ เพื่อยืนยันว่าเป็นคุณที่ลงนาม"
              : verify === "email"
                ? "รหัสใช้ได้ 10 นาที ไม่ได้รับ? กดขอรหัสอีกครั้ง"
                : "ระบบยังส่งอีเมลไม่ได้ จึงยืนยันตัวตนด้วยรหัสผ่านแทน"}
          </p>
        </div>
        <button className="btn primary" type="submit">
          <Icon name="check" />
          ยืนยันการลงนาม
        </button>
        <p className="tiny muted">
          ระบบบันทึกเวลา IP และวิธียืนยันตัวตนไว้ใน audit trail ของเอกสาร
        </p>
      </div>
    </Form>
  );
}
