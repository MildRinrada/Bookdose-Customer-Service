"use client";

import { useDialogs } from "@/components/ui/Dialogs";
import { FormActions, TextArea } from "@/components/ui/fields";
import { Form } from "@/components/ui/Form";

/* One text box and a reason (pages/contracts/project-reason-form.html): a slip that is wrong, voiding an invoice,
   sending a delivery back, asking for an MA contract. Opened in the modal; cancel closes it. */

export function ProjectReasonForm({
  name,
  label,
  hint,
  required,
  max,
  submitLabel,
  onSubmit,
}: {
  /** The field's name (reason, remark, note). */
  name: string;
  label: string;
  hint: string;
  required: boolean;
  max: number;
  submitLabel: string;
  /** Gets the text; throw to show the reason on the form. */
  onSubmit: (text: string) => Promise<unknown>;
}) {
  const { closeModal } = useDialogs();
  return (
    <Form onSubmit={(values) => onSubmit(values[name] ?? "")}>
      <TextArea
        id="reason-text"
        label={label}
        name={name}
        rows={4}
        max={max}
        required={required}
      />
      <p className="tiny muted">{hint}</p>
      <FormActions label={submitLabel} onCancel={() => closeModal()} />
    </Form>
  );
}
