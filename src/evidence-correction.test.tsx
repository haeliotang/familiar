import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { EvidenceCorrection } from './evidence-correction'

it('offers correction only when the encounter contains retractable evidence', () => {
  expect(renderToStaticMarkup(<EvidenceCorrection busy={false} onRetract={() => {}} />)).toBe('')
  expect(renderToStaticMarkup(<EvidenceCorrection evidenceId="synthetic-evidence" busy={false} onRetract={() => {}} />)).toContain('这个细节不对')
})

it.each([{ busy: true }, { busy: false, retracted: true }])('disables correction during submission or after retraction', state => {
  expect(renderToStaticMarkup(<EvidenceCorrection evidenceId="synthetic-evidence" {...state} onRetract={() => {}} />)).toContain('disabled=""')
})
