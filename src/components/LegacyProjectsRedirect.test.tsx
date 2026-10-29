import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { LegacyProjectsRedirect } from './LegacyProjectsRedirect'

function Where() {
  const { pathname, search, hash } = useLocation()
  return <p data-testid="where">{pathname + search + hash}</p>
}

function renderAt(url: string) {
  const { unmount } = render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/projects" element={<LegacyProjectsRedirect />} />
        <Route path="/projects/*" element={<LegacyProjectsRedirect />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
  const text = screen.getByTestId('where').textContent
  unmount()
  return text
}

describe('legacy /projects links', () => {
  it('forward to /events', () => {
    expect(renderAt('/projects')).toBe('/events')
  })

  it('keep the event id, sub-page, query string and hash', () => {
    expect(renderAt('/projects/4f1c-uuid')).toBe('/events/4f1c-uuid')
    expect(renderAt('/projects/4f1c-uuid/edit')).toBe('/events/4f1c-uuid/edit')
    expect(renderAt('/projects/4f1c-uuid?tab=payments#history')).toBe('/events/4f1c-uuid?tab=payments#history')
    expect(renderAt('/projects/new?client=abc')).toBe('/events/new?client=abc')
  })
})
