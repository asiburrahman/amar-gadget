"use client";
import { useId } from "react";
import { MAX_SPECIFICATIONS, type Specification } from "@/lib/validations/specifications";

export function SpecificationEditor({ value, onChange, disabled = false }: { value: Specification[]; onChange: (next: Specification[]) => void; disabled?: boolean }) {
  const id = useId();
  return <fieldset disabled={disabled} className="space-y-3 border rounded-lg p-3">
    <legend className="font-semibold">Technical specifications</legend>
    <p className="text-sm">Enter verified product details. Leave this empty when specifications are unavailable.</p>
    {value.map((item, index) => <div key={index} className="flex flex-wrap gap-2 items-end">
      <div><label htmlFor={`${id}-${index}-label`} className="block text-sm">Specification {index + 1}</label><input id={`${id}-${index}-label`} required maxLength={60} value={item.label} onChange={(event) => onChange(value.map((entry, position) => position === index ? { ...entry, label: event.target.value } : entry))} className="border rounded p-2" /></div>
      <div><label htmlFor={`${id}-${index}-value`} className="block text-sm">Value {index + 1}</label><input id={`${id}-${index}-value`} required maxLength={300} value={item.value} onChange={(event) => onChange(value.map((entry, position) => position === index ? { ...entry, value: event.target.value } : entry))} className="border rounded p-2" /></div>
      <button type="button" aria-label={`Remove specification ${index + 1}`} onClick={() => onChange(value.filter((_, position) => position !== index))}>Remove</button>
    </div>)}
    <button type="button" disabled={value.length >= MAX_SPECIFICATIONS} onClick={() => onChange([...value, { label: "", value: "" }])}>Add specification</button>
    <p className="text-xs">{value.length} of {MAX_SPECIFICATIONS} specifications</p>
  </fieldset>;
}
