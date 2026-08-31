import { PageHeader } from '../components/common/PageHeader'
import { PaymentsTable } from '../components/tables/PaymentsTable'
export function TransactionsPage(){return <><PageHeader eyebrow="Operations" title="Transactions" description="Successful, pending, failed and refunded payments across all products."/><PaymentsTable/></>}
