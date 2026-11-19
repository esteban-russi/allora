/** Required age and terms agreement checkbox shared by onboarding and the consent dialog. */
import React from 'react';
import { legalUrl } from '../utils/legalUrl';

export interface ConsentCheckboxProps {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * Render the 18+ and Terms/Privacy Policy agreement checkbox.
 *
 * Args:
 *   id: Unique HTML id linking the checkbox and its label.
 *   checked: Whether the checkbox is ticked.
 *   disabled: Optional disabled state while submitting.
 *   onChange: Called with the updated checked state.
 */
export const ConsentCheckbox: React.FC<ConsentCheckboxProps> = ({
  id,
  checked,
  disabled = false,
  onChange
}) => (
  <label
    htmlFor={id}
    className="flex items-start gap-3 text-sm text-ink-soft cursor-pointer select-none"
  >
    <input
      id={id}
      type="checkbox"
      required
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-cobalt cursor-pointer disabled:cursor-not-allowed"
    />
    <span className="leading-relaxed">
      I am 18 or older and I agree to the{' '}
      <a
        href={legalUrl('terms')}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-cobalt underline hover:text-cobalt-strong"
      >
        Terms
      </a>{' '}
      and the{' '}
      <a
        href={legalUrl('privacy')}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-cobalt underline hover:text-cobalt-strong"
      >
        Privacy Policy
      </a>
      .
    </span>
  </label>
);
