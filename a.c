#pragma GCC optimize
#include "pico/stdlib.h"
#include "hardware/gpio.h"
#include "hardware/sync.h"

#define SW_R 16
#define SW_L 17
#define IN_MASK ((1 << SW_L)|(1 << SW_R))
#define OUT_MASK 0xffff   // ← 修正済

void hello(uint gpio, uint32_t events)  // ← 名前変更
{
    uint32_t sw;

    sw = (gpio_get_all() & IN_MASK) >> SW_R;  
    gpio_put_masked(OUT_MASK, sw);
}

int main(void)
{
    gpio_init_mask(IN_MASK | OUT_MASK);
    gpio_set_dir_out_masked(OUT_MASK);
    gpio_pull_up(SW_L);
    gpio_pull_up(SW_R);
    gpio_put_masked(OUT_MASK, 3);

    gpio_set_irq_enabled(SW_L, GPIO_IRQ_EDGE_RISE | GPIO_IRQ_EDGE_FALL, true);  // ← セミコロン追加
    gpio_set_irq_enabled(SW_R, GPIO_IRQ_EDGE_RISE | GPIO_IRQ_EDGE_FALL, true);

    gpio_set_irq_callback(hello);   // ← ココだけ変更すればOK！

    irq_set_enabled(IO_IRQ_BANK0, true);   // ← 修正済

    for(;;){
        __wfi();   // Wait For Interrupt
    }
    return 0;
}
