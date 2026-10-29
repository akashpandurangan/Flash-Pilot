import { Navigate, useLocation, useParams } from 'react-router'

/**
 * "Events" used to be called "Projects" and lived under /projects. Old bookmarks, e-mails and
 * notification links stored in the database keep working: they are forwarded to the same page
 * under /events, with the path, query string and hash preserved.
 */
export function LegacyProjectsRedirect() {
  const rest = useParams()['*']
  const { search, hash } = useLocation()
  return <Navigate to={`/events${rest ? `/${rest}` : ''}${search}${hash}`} replace />
}
