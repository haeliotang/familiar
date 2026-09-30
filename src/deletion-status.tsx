import { useEffect, useState } from 'react'
import { api } from './api'

type Deletion = { deletionJobId: string; status: 'pending' | 'completed' }

export function DeletionStatus() {
  const [jobs, setJobs] = useState<Deletion[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const result = await api<{ deletions: Deletion[] }>('/v1/deletions')
        if (!active) return
        setJobs(result.deletions)
        setError(false)
        if (result.deletions.some(job => job.status === 'pending')) timer = setTimeout(() => { void load() }, 5_000)
      } catch {
        if (active) { setError(true); timer = setTimeout(() => { void load() }, 5_000) }
      }
    }
    void load()
    return () => { active = false; clearTimeout(timer) }
  }, [])

  if (error) return <p className="note" role="status">暂时无法确认删除进度，正在重新查询。</p>
  if (!jobs.length) return null
  const pending = jobs.filter(job => job.status === 'pending').length
  return <p className="note" role="status">{pending ? `已删除的资料已停止访问；还有 ${pending} 份文件清理任务正在处理，服务会自动重试。` : '已提交的删除任务已完成文件清理。'}</p>
}
