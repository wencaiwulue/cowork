#!/usr/bin/env python3
"""
LangChain 功能演示脚本

展示 LangChain 全家桶的主要功能：
1. Tools - 工具调用
2. Skills - 技能编排
3. RAG - 检索增强生成
4. Trace - 链路追踪

用法:
    export OPENAI_API_KEY=your_key
    python demo_langchain.py
"""

import asyncio
import os
import sys
from pathlib import Path

# 添加项目根目录到路径
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from app.services.langchain import LangChainService


async def demo_tools(service: LangChainService):
    """演示 Tools 功能"""
    print("\n" + "=" * 60)
    print("🔧 演示 1: Tools - 工具调用")
    print("=" * 60)

    # 列出可用 Tools
    tools = service.tool_manager.list_tools()
    print(f"\n可用 Tools ({len(tools)} 个):")
    for tool in tools:
        print(f"  • {tool['name']}: {tool['description'][:60]}...")

    # 执行 DuckDuckGo 搜索
    print("\n📝 执行 DuckDuckGo 搜索...")
    try:
        result = await service.tool_manager.invoke(
            tool_name="duckduckgo",
            input_data={"query": "LangChain Python tutorial"}
        )
        print(f"✅ 搜索结果:\n{result[:300]}...")
    except Exception as e:
        print(f"⚠️ 搜索失败: {e}")

    # 执行 Wikipedia 查询
    print("\n📝 执行 Wikipedia 查询...")
    try:
        result = await service.tool_manager.invoke(
            tool_name="wikipedia",
            input_data={"query": "Artificial Intelligence"}
        )
        print(f"✅ 查询结果:\n{result[:300]}...")
    except Exception as e:
        print(f"⚠️ 查询失败: {e}")


async def demo_skills(service: LangChainService):
    """演示 Skills 功能"""
    print("\n" + "=" * 60)
    print("🎯 演示 2: Skills - 技能编排")
    print("=" * 60)

    # 列出可用 Skills
    skills = service.skill_orchestrator.list_skills()
    print(f"\n可用 Skills ({len(skills)} 个):")
    for skill in skills:
        print(f"  • {skill['name']} (v{skill['version']}): {skill['description']}")

    # 执行 QA Skill
    if skills:
        print("\n📝 执行 QA Skill...")
        try:
            result = await service.skill_orchestrator.invoke(
                skill_id="qa-basic",
                input_data={
                    "context": "LangChain is a framework for developing applications powered by language models.",
                    "question": "What is LangChain?"
                }
            )
            print(f"✅ 回答:\n{result}")
        except Exception as e:
            print(f"⚠️ 执行失败: {e}")


async def demo_rag(service: LangChainService):
    """演示 RAG 功能"""
    print("\n" + "=" * 60)
    print("📚 演示 3: RAG - 检索增强生成")
    print("=" * 60)

    # 创建 RAG 配置
    from app.services.langchain.rag import RAGConfiguration

    rag_config = RAGConfiguration(
        id="demo-rag",
        name="Demo RAG",
        description="Demo RAG configuration"
    )

    service.rag_manager.create_config(rag_config)
    print(f"\n✅ 创建 RAG 配置: {rag_config.name} (ID: {rag_config.id})")

    # 列出配置
    configs = service.rag_manager.list_configs()
    print(f"\n可用 RAG 配置 ({len(configs)} 个):")
    for config in configs:
        print(f"  • {config['name']} (ID: {config['id']})")

    print("\n💡 提示: 使用 'POST /api/langchain/rag/documents' 上传文档")
    print("         使用 'POST /api/langchain/rag/ask' 进行问答")


async def demo_trace(service: LangChainService):
    """演示 Trace 功能"""
    print("\n" + "=" * 60)
    print("🔍 演示 4: Trace - 链路追踪")
    print("=" * 60)

    # 获取 Trace 配置
    if service.trace_manager:
        config = service.trace_manager.config
        print(f"\n✅ Trace 管理器已初始化")
        print(f"  • 本地存储: {'启用' if config.get('local_storage', {}).get('enabled') else '禁用'}")
        print(f"  • LangSmith: {'启用' if config.get('langsmith', {}).get('enabled') else '禁用'}")
        print(f"  • Langfuse: {'启用' if config.get('langfuse', {}).get('enabled') else '禁用'}")
        print(f"  • 实时推送: {'启用' if config.get('realtime', {}).get('enabled') else '禁用'}")

        # 创建回调处理器
        handler = service.trace_manager.get_callback_handler(
            session_id="demo-session",
            agent_id="demo-agent",
            tags=["demo", "test"]
        )
        print(f"\n✅ Trace 回调处理器已创建")
        print(f"  • Session ID: demo-session")
        print(f"  • Agent ID: demo-agent")
        print(f"  • Tags: {handler.tags}")
    else:
        print("\n⚠️ Trace 管理器未初始化")


async def main():
    """主函数"""
    import argparse

    parser = argparse.ArgumentParser(description="LangChain 功能演示")
    parser.add_argument("--demo", choices=["tools", "skills", "rag", "trace", "all"],
                       default="all", help="选择要运行的演示")
    parser.add_argument("--skip-init", action="store_true",
                       help="跳过服务初始化（假设已在外部初始化）")
    args = parser.parse_args()

    print("=" * 60)
    print("🦜 LangChain 全家桶功能演示")
    print("=" * 60)

    # 检查 OPENAI_API_KEY
    if not os.getenv("OPENAI_API_KEY"):
        print("\n⚠️ 警告: 未设置 OPENAI_API_KEY 环境变量")
        print("   某些功能可能无法正常工作")
        print("   设置方法: export OPENAI_API_KEY=your_key")

    # 初始化服务
    service = None
    if not args.skip_init:
        print("\n🚀 初始化 LangChain 服务...")
        try:
            config = {
                "llm": {
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                    "temperature": 0.7,
                    "api_key": os.getenv("OPENAI_API_KEY"),
                },
                "trace": {
                    "enabled": True,
                    "local_storage": {"enabled": True},
                }
            }

            service = LangChainService(config)
            await service.initialize()
            print("✅ LangChain 服务初始化成功\n")
        except Exception as e:
            print(f"\n❌ 初始化失败: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)
    else:
        # 如果跳过初始化，尝试获取全局服务实例
        from app.services.langchain import _langchain_service
        service = _langchain_service

    # 运行演示
    try:
        if args.demo in ["tools", "all"]:
            await demo_tools(service)

        if args.demo in ["skills", "all"]:
            await demo_skills(service)

        if args.demo in ["rag", "all"]:
            await demo_rag(service)

        if args.demo in ["trace", "all"]:
            await demo_trace(service)

    except Exception as e:
        print(f"\n❌ 演示执行出错: {e}")
        import traceback
        traceback.print_exc()

    # 清理
    if service and not args.skip_init:
        print("\n🧹 关闭服务...")
        await service.shutdown()
        print("✅ 服务已关闭")

    print("\n" + "=" * 60)
    print("✅ 演示完成！")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
