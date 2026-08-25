import { useEffect, useMemo, useState } from "react";
import type { CharacterSnapshot } from "./types";
import { GlobalMarketSearch } from "./GlobalMarketSearch";
import { appendShoppingList, loadShoppingList, OPEN_SHOPPING_LIST_EVENT, OPEN_SHOPPING_LIST_PENDING_KEY, saveShoppingList, SHOPPING_LIST_UPDATED_EVENT, type ShoppingItem, type ShoppingListAdd } from "./shopping-list";

const itemIcon = (typeId:number) => `https://images.evetech.net/types/${typeId}/icon?size=64`;

export function MarketWorkspaceV2({snapshot}:{snapshot?:CharacterSnapshot}){
  const [tab,setTab]=useState<"search"|"shopping">(() => sessionStorage.getItem(OPEN_SHOPPING_LIST_PENDING_KEY)==="1" ? "shopping" : "search");
  const [items,setItems]=useState<ShoppingItem[]>(loadShoppingList);
  const [status,setStatus]=useState("");
  useEffect(()=>{saveShoppingList(items);},[items]);
  useEffect(()=>{
    if(sessionStorage.getItem(OPEN_SHOPPING_LIST_PENDING_KEY)==="1"){
      sessionStorage.removeItem(OPEN_SHOPPING_LIST_PENDING_KEY);
      setTab("shopping");
    }
    const updated=(event:Event)=>{
      const detail=(event as CustomEvent<{items?:ShoppingItem[];message?:string}>).detail;
      setItems(Array.isArray(detail?.items)?detail.items:loadShoppingList());
      if(detail?.message)setStatus(detail.message);
      setTab("shopping");
    };
    const open=()=>{sessionStorage.removeItem(OPEN_SHOPPING_LIST_PENDING_KEY);setItems(loadShoppingList());setTab("shopping");};
    window.addEventListener(SHOPPING_LIST_UPDATED_EVENT,updated as EventListener);
    window.addEventListener(OPEN_SHOPPING_LIST_EVENT,open);
    return()=>{window.removeEventListener(SHOPPING_LIST_UPDATED_EVENT,updated as EventListener);window.removeEventListener(OPEN_SHOPPING_LIST_EVENT,open);};
  },[]);
  function add(input:ShoppingListAdd){appendShoppingList([input],`${input.name} added to Shopping List.`);}
  const remaining=useMemo(()=>items.filter(item=>!item.done),[items]);
  const completed=items.length-remaining.length;
  async function open(item:ShoppingItem){
    if(!snapshot?.characterId){setStatus("Select a connected character before opening items in EVE.");return;}
    setStatus(`Opening ${item.name} in EVE...`);
    try{
      const result=await window.sage.openEveMarketType({characterId:snapshot.characterId,typeId:item.typeId});
      setStatus(`Opened ${item.name} for ${result.characterName}${result.usedFallback?" (online character)":""}. Buy ${item.quantity.toLocaleString()} then mark it bought.`);
    }catch(error){setStatus(error instanceof Error?error.message:"Could not open the item market in EVE.");}
  }
  async function openNext(){const next=remaining[0];if(!next){setStatus("Shopping List complete.");return;}await open(next);}
  function setQuantity(id:string,value:string){setItems(current=>current.map(row=>row.id===id?{...row,quantity:Math.max(1,Math.floor(Number(value)||1))}:row));}
  function toggleDone(id:string){setItems(current=>current.map(row=>row.id===id?{...row,done:!row.done}:row));}
  function remove(id:string){setItems(current=>current.filter(row=>row.id!==id));}

  return <section className="market-workspace-v2">
    <div className="market-v2-tabs">
      <button className={tab==="search"?"active":""} onClick={()=>setTab("search")}><strong>Market Search</strong><span>Find current retained orders</span></button>
      <button className={tab==="shopping"?"active":""} onClick={()=>setTab("shopping")}><strong>Shopping List</strong><span>{remaining.length} remaining</span></button>
    </div>
    {status&&<div className="market-v2-status">{status}</div>}
    {tab==="search"&&<GlobalMarketSearch snapshot={snapshot} onAddToShoppingList={add}/>}
    {tab==="shopping"&&<section className="market-shopping-list">
      <div className="market-shopping-head">
        <div><p className="eyebrow">EVE PURCHASE RUNNER</p><h2>Shopping List</h2><p>Work the list directly against the EVE market, then mark each line complete.</p></div>
        <button className="primary market-shopping-next" onClick={()=>void openNext()} disabled={!remaining.length}>Open Next in EVE</button>
      </div>
      <div className="market-shopping-summary">
        <article><span>Remaining</span><strong>{remaining.length}</strong></article>
        <article><span>Completed</span><strong>{completed}</strong></article>
        <article><span>Total lines</span><strong>{items.length}</strong></article>
      </div>
      <div className="market-shopping-rows">
        {items.map(item=><article key={item.id} className={`market-shopping-row${item.done?" done":""}`}>
          <div className="market-shopping-item">
            <img src={itemIcon(item.typeId)} alt="" loading="lazy"/>
            <div><span>{item.done?"BOUGHT":"TO BUY"}</span><strong>{item.name}</strong><small>Added {new Date(item.addedAt).toLocaleString()}</small></div>
          </div>
          <label className="market-shopping-qty"><span>Qty</span><input value={item.quantity} type="number" min={1} onChange={e=>setQuantity(item.id,e.target.value)}/></label>
          <div className="market-shopping-actions">
            <button className="market-shopping-open" onClick={()=>void open(item)}>Open in EVE</button>
            <button className="market-shopping-done" onClick={()=>toggleDone(item.id)}>{item.done?"Undo":"Mark bought"}</button>
            <button className="market-shopping-remove" onClick={()=>remove(item.id)}>Remove</button>
          </div>
        </article>)}
        {!items.length&&<div className="market-v2-empty">Your shopping list is empty. Export a fit or add an item from Market Search.</div>}
      </div>
      {completed>0&&<button className="market-shopping-clear" onClick={()=>setItems(current=>current.filter(item=>!item.done))}>Clear completed</button>}
    </section>}
  </section>;
}
