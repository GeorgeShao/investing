import type { InputHTMLAttributes } from "react";
import {
  isLoneNumericZero,
  normalizeNumericInput,
} from "@/lib/numeric-input";

type NumericFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "onChange" | "value"
> & {
  value: string | number;
  onValueChange: (value: string) => void;
};

/**
 * Number input that strips leading zeros as you type. A lone 0 is selected
 * on focus so the next digit replaces it instead of becoming 05.
 */
export function NumericField({
  value,
  onValueChange,
  onFocus,
  ...props
}: NumericFieldProps) {
  const text = String(value);
  return (
    <input
      type="number"
      value={text}
      onChange={(e) => onValueChange(normalizeNumericInput(e.target.value))}
      onFocus={(e) => {
        if (isLoneNumericZero(e.currentTarget.value)) {
          e.currentTarget.select();
        }
        onFocus?.(e);
      }}
      {...props}
    />
  );
}
