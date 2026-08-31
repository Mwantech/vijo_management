import { Link } from 'react-router-dom'
export function NotFoundPage(){return <div className="access-denied"><h2>Page not found</h2><p>The management page you requested does not exist.</p><Link className="button button--primary" to="/dashboard">Back to overview</Link></div>}
